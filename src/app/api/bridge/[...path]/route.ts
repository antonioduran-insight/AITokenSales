import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { backendHeaders, SCRAPER_API_URL } from '@/lib/scraper-backend'

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

  // Always scope reads to this org.
  const search = new URLSearchParams(req.nextUrl.searchParams)
  search.set('organization_id', orgId)
  const url = `${BACKEND}${pathStr}?${search.toString()}`

  const init: RequestInit = { method: req.method, headers: backendHeaders() }
  // Set only for POST /bridge/runs — used below to backfill the response if
  // the backend doesn't echo it back (the client needs an id to start polling).
  let generatedRunId: string | null = null

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? JSON.parse(raw) : {}
    } catch { body = {} }

    body.organization_id = orgId

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

      // Unlike the main scraper (which owns a `runs` table row and passes its
      // id to the backend), Bridge has no local run table — the backend is
      // the sole owner of run state. Its POST /bridge/runs schema requires
      // run_id in the request body rather than generating one itself, so we
      // generate it here, the same way the main scraper's run_id originates
      // from the CRM side rather than the backend.
      if (!body.run_id) {
        generatedRunId = randomUUID()
        body.run_id = generatedRunId
      }
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
        .select('id')
        .eq('id', sdrId)
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .maybeSingle()
      if (!sdr) {
        return NextResponse.json({ error: 'SDR not found in this organization' }, { status: 400 })
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

    // Guarantee the client gets back an id it can poll with, regardless of
    // whether the backend echoes the run_id we generated above.
    if (generatedRunId && res.ok) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && !parsed.id && !parsed.run_id) {
          text = JSON.stringify({ ...parsed, run_id: generatedRunId })
        }
      } catch { /* backend didn't return JSON — leave the passthrough as-is */ }
    }

    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const DELETE = proxy
