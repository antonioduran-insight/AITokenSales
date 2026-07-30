import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { backendHeaders, SCRAPER_API_URL } from '@/lib/scraper-backend'
import { assignBridgeCandidates } from '@/lib/utils/bridge-assign'

const BACKEND = SCRAPER_API_URL || 'http://localhost:8000'

// Authenticated reverse proxy to the Bridge endpoints on the Python backend.
//
// The caller never supplies organization_id or apify_token: we resolve them
// from the session and inject them, so one org can't read or mutate another
// org's seed lists, runs or candidates.
async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  // Bridge is an admin-only tool.
  if (userData?.role !== 'admin' || !userData.organization_id) {
    return NextResponse.json({ error: 'Only the organization admin can use Bridge' }, { status: 403 })
  }
  const orgId = userData.organization_id as string

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Gate on the bridge add-on being active for this org.
  const { data: addon } = await admin
    .from('organization_addons')
    .select('id')
    .eq('organization_id', orgId)
    .eq('addon_type', 'bridge')
    .eq('is_active', true)
    .maybeSingle()

  if (!addon) {
    return NextResponse.json({ error: 'The Bridge add-on is not active for this organization' }, { status: 403 })
  }

  const { path } = await params
  const pathStr = '/bridge/' + path.join('/')

  // Listing runs ("Past Searches") is NOT proxied — the backend only
  // implements POST /bridge/runs (create), not GET (list), and 405s. We
  // already own bridge_runs (the proxy inserts into it on create), so read
  // it directly here instead, the same way /api/runs reads `runs` straight
  // from Supabase rather than asking the scraper backend to list anything.
  // GET /bridge/runs/{id} and /logs are unaffected — those the backend does
  // support, and keep proxying through below.
  if (pathStr === '/bridge/runs' && req.method === 'GET') {
    const { data, error } = await admin
      .from('bridge_runs')
      .select('id, seed_list_id, status, total_candidates, error_message, started_at, completed_at, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const runs = (data ?? []).map(r => ({
      id: r.id,
      seed_list_id: r.seed_list_id,
      status: r.status,
      candidates_found: r.total_candidates ?? 0,
      error_message: r.error_message,
      started_at: r.started_at,
      completed_at: r.completed_at,
      created_at: r.created_at,
    }))
    return NextResponse.json(runs)
  }

  // Always scope reads to this org.
  const search = new URLSearchParams(req.nextUrl.searchParams)
  search.set('organization_id', orgId)
  const url = `${BACKEND}${pathStr}?${search.toString()}`

  const init: RequestInit = { method: req.method, headers: backendHeaders() }
  // Set only for POST /bridge/runs. The bridge_runs row we create below is
  // the authoritative id — used to force it into the response regardless of
  // what shape the backend echoes back.
  let createdRunId: string | null = null
  // Set only for POST /bridge/candidates/confirm-batch. Once the backend has
  // confirmed the candidates and written their messages, the CRM owns the
  // handoff into `prospects` (see bridge-assign.ts) — these carry the
  // already-validated inputs across to the response block below.
  let confirmCandidateIds: string[] | null = null
  let confirmSdrId: string | null = null

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? JSON.parse(raw) : {}
    } catch { body = {} }

    body.organization_id = orgId

    // The backend's seed-list schema doesn't match what the CRM's form was
    // sending (companies/criteria.headcounts/criteria.market/criteria.industry)
    // — Pydantic silently dropped every one of those fields instead of
    // erroring, so every seed list ever created (including the two that
    // already exist) has empty company_names/company_headcounts/geo_codes/
    // industry_codes. Transform to the backend's real field names here.
    // Applies to CREATE (POST /bridge/seed-lists) and EDIT
    // (PATCH /bridge/seed-lists/{id}) alike. Both must go through it: the edit
    // form sends the same shape the create form does, and a PATCH carrying
    // `companies`/`criteria` would be silently discarded by Pydantic exactly
    // as the original creates were — the same bug, reintroduced through a
    // different verb.
    const isSeedListWrite =
      (pathStr === '/bridge/seed-lists' && req.method === 'POST') ||
      (/^\/bridge\/seed-lists\/[^/]+$/.test(pathStr) && req.method === 'PATCH')

    if (isSeedListWrite) {
      const isPatch = req.method === 'PATCH'
      const hasCompanies = 'companies' in body
      const hasCriteria = 'criteria' in body

      const companies = Array.isArray(body.companies) ? (body.companies as string[]) : []
      const criteria = (body.criteria ?? {}) as { industry?: string | null; headcounts?: string[]; market?: string | null }

      let geoCodes: number[] = []
      if (criteria.market) {
        const { data: marketRows } = await admin
          .from('markets')
          .select('geo_code')
          .ilike('name', criteria.market)
        geoCodes = (marketRows ?? [])
          .map(m => (m as { geo_code: unknown }).geo_code)
          .filter((c): c is number => typeof c === 'number')
      }

      // On PATCH, only translate what the client actually sent. The backend
      // distinguishes "absent" (leave alone) from "empty" (clear), and writing
      // a default [] for an untouched key would erase filters the user never
      // opened — renaming a list would wipe its companies.
      if (!isPatch || hasCompanies) body.company_names = companies
      if (!isPatch || hasCriteria) {
        body.company_headcounts = criteria.headcounts ?? []
        body.geo_codes = geoCodes
        // No industry-name -> industry-code mapping exists anywhere in this
        // project yet (checked: no table, no constant). Sending [] rather than
        // guessing a code — criteria.industry is a known, documented gap until
        // that mapping is built as its own task.
        body.industry_codes = []
      }

      delete body.companies
      delete body.criteria
    }

    // Starting a Bridge run needs the org's Apify token, same as the scraper.
    if (pathStr === '/bridge/runs') {
      const { data: org } = await admin
        .from('organizations')
        .select('apify_token')
        .eq('id', orgId)
        .single()
      if (!org?.apify_token) {
        return NextResponse.json(
          { error: 'Apify token must be configured in Settings → Scraper before running Bridge.' },
          { status: 400 }
        )
      }
      body.apify_token = org.apify_token

      // Same pattern as the main scraper's `runs` table: the CRM creates the
      // row FIRST (status='pending') and passes its id as run_id — the
      // backend looks up and validates that row rather than creating its own,
      // and updates it (status, total_candidates, started_at/completed_at,
      // error_message) as the run progresses. GET /bridge/runs/[id] proxies
      // straight to the backend, which reads this same row.
      const seedListId = typeof body.seed_list_id === 'string' ? body.seed_list_id : null
      const { data: bridgeRun, error: bridgeRunError } = await admin
        .from('bridge_runs')
        .insert({ organization_id: orgId, seed_list_id: seedListId, status: 'pending' })
        .select('id')
        .single()

      if (bridgeRunError || !bridgeRun) {
        return NextResponse.json(
          { error: bridgeRunError?.message ?? 'Failed to create Bridge run' },
          { status: 500 }
        )
      }
      createdRunId = bridgeRun.id as string
      body.run_id = createdRunId
    }

    // Batch-confirming candidates generates personalised partnership messages,
    // so the backend needs the org's Anthropic credentials and Bridge context —
    // all resolved here so none of them travel through the browser.
    if (pathStr === '/bridge/candidates/confirm-batch') {
      const { data: org } = await admin
        .from('organizations')
        .select('anthropic_key, anthropic_base_url, anthropic_model, bridge_context')
        .eq('id', orgId)
        .single()

      if (!org?.anthropic_key) {
        return NextResponse.json(
          { error: 'Anthropic key must be configured in Settings → Scraper before confirming candidates.' },
          { status: 400 }
        )
      }
      body.anthropic_key = org.anthropic_key
      body.anthropic_base_url = org.anthropic_base_url ?? null
      body.anthropic_model = org.anthropic_model ?? null
      body.bridge_context = org.bridge_context ?? ''

      // The SDR must belong to this org — never take the client's word for it.
      const sdrId = typeof body.sdr_id === 'string' ? body.sdr_id : null
      if (!sdrId) {
        return NextResponse.json({ error: 'sdr_id is required' }, { status: 400 })
      }
      const { data: sdr } = await admin
        .from('users')
        .select('id, area_id')
        .eq('id', sdrId)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .maybeSingle()
      if (!sdr) {
        return NextResponse.json({ error: 'SDR not found in this organization' }, { status: 400 })
      }

      // The confirmed candidates get copied into `prospects` after the backend
      // responds, and `prospects.area_id` is NOT NULL — the SDR's own area is
      // the only source Bridge has for it (no region/market of its own). Fail
      // here, BEFORE the backend confirms and burns Anthropic tokens generating
      // messages, rather than confirming and then discovering the leads have
      // nowhere to land. Never insert with an invented area.
      if (!(sdr as { area_id: string | null }).area_id) {
        return NextResponse.json(
          { error: 'The selected SDR has no area set — set it in Settings → Users before confirming candidates.' },
          { status: 400 }
        )
      }

      confirmSdrId = sdrId
      confirmCandidateIds = Array.isArray(body.candidate_ids)
        ? (body.candidate_ids as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
        : []
      if (confirmCandidateIds.length === 0) {
        return NextResponse.json({ error: 'candidate_ids is required' }, { status: 400 })
      }

      // Resolve the SDR's default sender profile so the client never has to.
      if (!body.sender_profile_id) {
        const { data: profile } = await admin
          .from('sender_profiles')
          .select('id')
          .eq('user_id', sdrId)
          .eq('organization_id', orgId)
          .eq('is_default', true)
          .eq('is_active', true)
          .maybeSingle()
        body.sender_profile_id = profile?.id ?? null
      }
    }

    init.body = JSON.stringify(body)
  }

  try {
    const res = await fetch(url, init)
    let text = await res.text()

    if (createdRunId) {
      if (res.ok) {
        // We already know the true id (the row we just created) — force it
        // into the response unconditionally rather than trusting the backend
        // echoed it back in a shape we happen to recognise. This is what the
        // client polls with, so any mismatch here means "run not found".
        try {
          const parsed = JSON.parse(text)
          text = JSON.stringify({ ...(parsed && typeof parsed === 'object' ? parsed : {}), id: createdRunId, run_id: createdRunId })
        } catch {
          text = JSON.stringify({ id: createdRunId, run_id: createdRunId })
        }
      } else {
        // The backend rejected the run (bad seed list, Apify error, etc.) —
        // don't leave the row stuck at 'pending' forever with no explanation.
        await admin
          .from('bridge_runs')
          .update({ status: 'failed', error_message: text.slice(0, 2000) })
          .eq('id', createdRunId)
      }
    }

    // The backend deliberately does NOT insert into `prospects` (it has no
    // value for CRM-owned NOT NULL columns like area_id) and documents the CRM
    // as the owner of that step. It was implemented for the main scraper
    // (`assignRunLeads`) and never for Bridge, so confirmed candidates with
    // generated messages died in `bridge_candidates` and the SDR saw nothing.
    // This is that missing step.
    if (res.ok && confirmCandidateIds && confirmSdrId) {
      let created = 0
      let notCreated = confirmCandidateIds.length
      // Split out of `notCreated` so the UI can tell a benign outcome (already
      // on that SDR's board — a re-confirm/retry) apart from a real loss.
      let skippedExisting = 0
      let skippedNoName = 0
      let assignError: string | null = null

      try {
        const result = await assignBridgeCandidates({
          admin,
          candidateIds: confirmCandidateIds,
          sdrId: confirmSdrId,
          organizationId: orgId,
        })
        if (result.ok) {
          created = result.assigned
          notCreated = Math.max(0, confirmCandidateIds.length - result.assigned)
          skippedExisting = result.skipped
          skippedNoName = result.skippedNoName
        } else {
          assignError = result.error
        }
      } catch (e) {
        assignError = String(e)
      }

      if (assignError) {
        console.error('[bridge] confirm-batch succeeded but prospects handoff failed:', assignError)
      }

      // A failed handoff must NOT fail the response: the backend already
      // confirmed the candidates and generated their messages, and replaying
      // that is neither free nor idempotent on its side. But it must not be
      // invisible either — the UI reports `ids.length` blindly today, which is
      // exactly how this bug stayed hidden. Return the real numbers so it can
      // tell the truth.
      let payload: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(text)
        payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { result: parsed }
      } catch {
        payload = {}
      }

      return NextResponse.json({
        ...payload,
        crm_prospects_created: created,
        crm_prospects_not_created: notCreated,
        crm_prospects_skipped_existing: skippedExisting,
        crm_prospects_skipped_no_name: skippedNoName,
        crm_prospects_error: assignError,
      }, { status: res.status })
    }

    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (e) {
    if (createdRunId) {
      await admin
        .from('bridge_runs')
        .update({ status: 'failed', error_message: String(e).slice(0, 2000) })
        .eq('id', createdRunId)
    }
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const DELETE = proxy
