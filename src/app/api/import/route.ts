import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MAX_IMPORT_ROWS, LEAD_TEMPERATURES, normalizeIcpScore, normalizeSearchCombo } from '@/lib/types'
import type { LeadTemperature } from '@/lib/types'

async function getCallerProfile() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users')
    .select('id, role, area_id, organization_id, workspace_id')
    .eq('id', user.id)
    .single()
  return profile ?? null
}

function getYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Best-effort bookkeeping. This runs AFTER the rows are already inserted, so
// it must not be able to throw: `.catch()` used to be chained straight onto
// the Supabase query builder, which is a thenable that only implements
// `then()` — the chain itself can blow up before the RPC is even attempted,
// the handler then returns a 500 HTML error page, the client's `res.json()`
// fails on it, and a perfectly successful import is reported to the user as
// "Import status unknown" (the exact bug seen with a clean 2-row import).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function incrementMonthlyLeads(admin: any, orgId: string, count: number) {
  if (count <= 0) return
  try {
    const yearMonth = getYearMonth()
    const { error } = await admin.rpc('increment_monthly_leads', {
      p_org_id: orgId,
      p_year_month: yearMonth,
      p_count: count,
    })
    if (error) console.error('[import] increment_monthly_leads failed (non-fatal):', error.code, error.message)
  } catch (e) {
    // RPC not applied / transport error — never fatal to an import that already
    // wrote its rows.
    console.error('[import] increment_monthly_leads threw (non-fatal):', e)
  }
}

/**
 * Columns a CSV import is allowed to set. `prospects` has plenty of others and
 * this route writes with the SERVICE_ROLE key, which bypasses RLS entirely —
 * the previous `{ ...r, organization_id: orgId }` spread passed through
 * whatever the client sent, so any authenticated caller (an `sdr` included)
 * could set `outreach_status: 'closed'` (skipping the mandatory
 * CloseDealModal chat upload) or point `assigned_to` at another org's user.
 * Anything not listed here is either derived from the session below or left
 * to the DB default.
 */
const IMPORTABLE_COLUMNS = [
  'name', 'linkedin_url', 'email', 'company', 'title', 'industry', 'company_size',
  'icp_score', 'lead_temperature', 'search_combo', 'scrape_date',
  'custom1', 'custom2', 'market', 'flag_tomorrow',
] as const

/** Trim to a non-empty string, or null. Numbers are accepted and stringified. */
function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Postgres error code → something a sales admin can act on. The raw Postgres
 * message leaks constraint/column names and reads like SQL, so it stays in the
 * server log only and never reaches the client.
 */
function friendlyDbError(code?: string): string {
  switch (code) {
    case '23505': return 'Already exists in this organization.'
    case '23514': return 'A value was outside the allowed range — ICP score must be 0-100 and Search Combo must be combo_A to combo_F.'
    case '23503': return 'A row pointed at an area or user that no longer exists.'
    case '23502': return 'A required field was empty.'
    case '22007':
    case '22008': return 'A date could not be read — use YYYY-MM-DD.'
    case '22P02': return 'A number or date field contained text that could not be read.'
    case '22001': return 'A value was too long for its field.'
    case '42501': return 'The database refused the write.'
    default: return 'Some rows were rejected by the database — the technical details are in the server log.'
  }
}

// POST /api/import — dedup check + return domain blacklist
//
// Checked org-wide (not scoped to one area) against both `prospects` and
// `scraper_leads` by linkedin_url — a lead already known anywhere in the org
// should surface as a duplicate here, regardless of which SDR's board or
// which scraper run it came from. `area_id` is not needed for this check
// (only for the insert step later); the org comes from the caller's own
// session, never a client-supplied value.
export async function POST(req: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.organization_id) return NextResponse.json({ dupEmails: {}, dupLinkedins: {}, blacklistedDomains: [] })

  const { emails, linkedins } = await req.json()
  const orgId = caller.organization_id

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch existing prospects + scraper leads + org blacklist in parallel —
  // both tables are checked so a lead already scraped (but not yet exported)
  // still shows up as a duplicate.
  const [existingRes, scraperLeadsRes, orgRes] = await Promise.all([
    admin.from('prospects').select('id, name, email, linkedin_url').eq('organization_id', orgId),
    admin.from('scraper_leads').select('full_name, linkedin_url').eq('organization_id', orgId),
    admin.from('organizations').select('domain_blacklist').eq('id', orgId).single(),
  ])

  const emailMap: Record<string, string> = {}
  const linkedinMap: Record<string, string> = {}
  existingRes.data?.forEach(p => {
    if (p.email) emailMap[p.email.toLowerCase()] = p.name
    if (p.linkedin_url) linkedinMap[p.linkedin_url.toLowerCase()] = p.name
  })
  scraperLeadsRes.data?.forEach(l => {
    if (l.linkedin_url && !linkedinMap[l.linkedin_url.toLowerCase()]) {
      linkedinMap[l.linkedin_url.toLowerCase()] = l.full_name ?? 'Unknown'
    }
  })

  const dupEmails: Record<string, string> = {}
  const dupLinkedins: Record<string, string> = {}
  for (const e of (emails ?? [])) {
    const key = e.toLowerCase()
    if (emailMap[key]) dupEmails[key] = emailMap[key]
  }
  for (const l of (linkedins ?? [])) {
    const key = l.toLowerCase()
    if (linkedinMap[key]) dupLinkedins[key] = linkedinMap[key]
  }

  // Parse domain blacklist
  const rawBlacklist: string = (orgRes as { data?: { domain_blacklist?: string } | null }).data?.domain_blacklist ?? ''
  const blacklistedDomains = rawBlacklist
    ? rawBlacklist.split(/[\n,]/).map(d => d.trim().toLowerCase()).filter(Boolean)
    : []

  return NextResponse.json({ dupEmails, dupLinkedins, blacklistedDomains })
}

// PUT /api/import — insert records + increment monthly counter
export async function PUT(req: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Defense in depth (QA-F4) — impersonation is a client-side-only URL
  // convention (?impersonate_org_id=...), never a server-side session flag,
  // so a client-supplied impersonate_org_id can't be trusted as the check.
  // What's actually verifiable server-side: only org-scoped roles (admin,
  // sdr) have a real organization_id; admin_global/support always have
  // organization_id = null, whether or not they're currently impersonating.
  // Without this, a caller with a null org_id (e.g. an admin_global mid-
  // impersonation, since the wizard never used to block this) would insert
  // prospects with organization_id: null — orphaned rows invisible to
  // every org's RLS-scoped queries. This blocks that at the source instead
  // of trying to detect "impersonating" specifically.
  if (!caller.organization_id) {
    return NextResponse.json({ error: 'Import is not available for this account.' }, { status: 403 })
  }

  const orgId: string = caller.organization_id

  // A malformed body must come back as JSON too — an uncaught throw here
  // returns an HTML error page the client can't parse, which it can only
  // report as "status unknown".
  let body: { records?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }
  const records = body?.records
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'No records to insert' }, { status: 400 })
  }
  // Defense in depth — the wizard already blocks this before column mapping,
  // but this route must not trust that check alone.
  if (records.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `Maximum ${MAX_IMPORT_ROWS} leads per import. Got ${records.length} rows.` }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const rawRecords = records as Record<string, unknown>[]

  // --- Who these leads belong to. Never taken from the client as-is. ---
  // An `sdr` can only import onto their own board: the wizard never shows them
  // the SDR picker, and nothing else should let them park leads on a colleague.
  const forcedAssignee = caller.role === 'sdr' ? (caller.id as string) : null
  const requestedAssignees = new Set<string>()
  for (const raw of rawRecords) {
    requestedAssignees.add(forcedAssignee ?? str(raw.assigned_to) ?? caller.id)
  }

  // Every assignee must be an active member of the caller's own org, and
  // `area_id` is read off that user's row rather than trusted from the client
  // (an SDR seeing leads is driven by area, so a client-chosen area_id is a
  // cross-area leak waiting to happen).
  const areaByUserId = new Map<string, string | null>()
  // Site is read off the assignee's row for the same reason area_id is: it
  // decides who can see the lead, so it must never come from the client.
  const workspaceByUserId = new Map<string, string | null>()
  const { data: assignees, error: assigneeErr } = await admin
    .from('users')
    .select('id, area_id, workspace_id')
    .in('id', [...requestedAssignees])
    .eq('organization_id', orgId)
    .eq('is_active', true)
  if (assigneeErr) {
    console.error('[import] assignee lookup failed:', assigneeErr.code, assigneeErr.message)
    return NextResponse.json({ error: 'Could not verify who these leads should be assigned to. Please try again.' }, { status: 500 })
  }
  for (const u of (assignees ?? []) as { id: string; area_id: string | null; workspace_id: string | null }[]) {
    areaByUserId.set(u.id, u.area_id)
    workspaceByUserId.set(u.id, u.workspace_id)
  }
  // The caller themselves is always a legitimate destination (self-import),
  // even in the edge case where their own row didn't come back above.
  if (!areaByUserId.has(caller.id)) areaByUserId.set(caller.id, caller.area_id ?? null)
  if (!workspaceByUserId.has(caller.id)) workspaceByUserId.set(caller.id, caller.workspace_id ?? null)

  const foreignAssignees = [...requestedAssignees].filter(id => !areaByUserId.has(id))
  if (foreignAssignees.length > 0) {
    console.error('[import] rejected: assignee(s) outside org', orgId, foreignAssignees)
    return NextResponse.json(
      { error: 'These leads were assigned to someone who is not an active member of this organization.' },
      { status: 403 }
    )
  }

  // --- Build the rows: allow-listed column by allow-listed column. ---
  const COLUMN_SANITIZERS: { [K in typeof IMPORTABLE_COLUMNS[number]]: (v: unknown) => unknown } = {
    name: str,
    linkedin_url: str,
    email: str,
    company: str,
    title: str,
    industry: str,
    company_size: str,
    scrape_date: str,
    custom1: str,
    custom2: str,
    market: str,
    icp_score: normalizeIcpScore,
    search_combo: normalizeSearchCombo,
    lead_temperature: v => (LEAD_TEMPERATURES.includes(v as LeadTemperature) ? (v as LeadTemperature) : null),
    flag_tomorrow: v => v === true || v === 'true',
  }

  const rows: Record<string, unknown>[] = []
  let imported = 0
  let duplicates = 0
  let rejected = 0
  // Subset of `rejected` that came back from the DB (i.e. was attempted).
  // Needed to tell "rejected" apart from "never got as far as being tried".
  let dbRejected = 0
  let icpDropped = 0
  let comboDropped = 0
  // Deduped, human-readable reasons. Raw Postgres messages stay in the log.
  const reasons = new Set<string>()

  for (const raw of rawRecords) {
    const row: Record<string, unknown> = {}
    for (const col of IMPORTABLE_COLUMNS) row[col] = COLUMN_SANITIZERS[col](raw[col])

    if (row.icp_score === null && str(raw.icp_score) !== null) icpDropped++
    if (row.search_combo === null && str(raw.search_combo) !== null) comboDropped++

    if (!row.name) {
      rejected++
      reasons.add('A row had no name.')
      continue
    }

    const assignedTo = forcedAssignee ?? str(raw.assigned_to) ?? caller.id
    const areaId = areaByUserId.get(assignedTo) ?? null
    if (!areaId) {
      rejected++
      reasons.add('The user these leads are assigned to has no area set — set it in Settings → Users first.')
      continue
    }

    rows.push({
      ...row,
      // Session-derived / fixed. Deliberately NOT accepted from the client:
      // `outreach_status` in particular is what let an sdr write 'closed'
      // straight past the mandatory CloseDealModal chat upload.
      organization_id: orgId,
      area_id: areaId,
      // Inherited from whoever receives the lead, never from the CSV.
      workspace_id: workspaceByUserId.get(assignedTo) ?? null,
      assigned_to: assignedTo,
      created_by: caller.id,
      source: 'csv_import',
      outreach_status: 'new',
    })
  }

  // Batches of 25 (not 100): when a batch fails, every record in it falls back
  // to an individual insert below — a smaller batch caps how much fallback
  // work one bad row can trigger.
  const BATCH_SIZE = 25
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error, data } = await admin.from('prospects').insert(batch).select('id')
      if (!error) {
        imported += data?.length ?? 0
        continue
      }

      // ANY batch-level error retries row by row, not just 23505 (duplicate):
      // a single 23514 (CHECK violation) used to discard all 25 rows in the
      // batch, the valid ones included — 3 good leads lost to 1 bad one.
      // Still in parallel, never sequentially. A fully sequential fallback
      // (one Supabase round trip after another) is what pushed a real import
      // past the serverless function's time limit: the response got cut off
      // mid-stream, the client saw "Unexpected end of JSON input", and the
      // insert had already succeeded server-side by then.
      console.error(`[import] batch at ${i} failed (${error.code ?? 'no code'}): ${error.message} — retrying ${batch.length} rows individually`)
      const results = await Promise.all(
        batch.map(record => admin.from('prospects').insert(record).select('id'))
      )
      results.forEach(({ error: e, data: d }, idx) => {
        if (!e) {
          imported += d?.length ?? 0
          return
        }
        if (e.code === '23505') {
          duplicates++
          return
        }
        rejected++
        dbRejected++
        reasons.add(friendlyDbError(e.code))
        console.error(`[import] row ${i + idx} rejected (${e.code ?? 'no code'}): ${e.message}${e.details ? ` | ${e.details}` : ''}`)
      })
    }
  } catch (e) {
    // Transport-level failure mid-loop. Whatever already landed still counts;
    // the shortfall is reported as `notAttempted` below.
    console.error('[import] insert loop threw:', e)
    reasons.add('The import stopped early because of a connection problem — some rows were not saved.')
  }

  await incrementMonthlyLeads(admin, orgId, imported)

  // Always 200 with counts (auth/shape problems above are the only non-200s).
  // A partial result is a normal outcome for an import, not a failed request,
  // and the client needs the numbers in every case to report honestly.
  return NextResponse.json({
    ok: true,
    imported,
    /** Rejected by the unique key — the lead already exists (23505). */
    duplicates,
    /** Rejected by validation / a CHECK constraint / a bad value. */
    rejected,
    /** Rows never attempted because the loop aborted. 0 in the happy path. */
    notAttempted: Math.max(0, rows.length - imported - duplicates - dbRejected),
    /** Rows accepted with their ICP score / combo dropped as unusable. */
    icpDropped,
    comboDropped,
    /** Human-readable, deduped. Never a raw Postgres message. */
    errors: [...reasons],
  })
}
