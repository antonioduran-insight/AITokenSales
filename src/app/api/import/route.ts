import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { MAX_IMPORT_ROWS } from '@/lib/types'

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
    .select('id, role, area_id, organization_id')
    .eq('id', user.id)
    .single()
  return profile ?? null
}

function getYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function incrementMonthlyLeads(admin: any, orgId: string, count: number) {
  if (count <= 0) return
  const yearMonth = getYearMonth()
  await admin.rpc('increment_monthly_leads', {
    p_org_id: orgId,
    p_year_month: yearMonth,
    p_count: count,
  }).catch(() => {
    // RPC not yet applied — non-fatal
  })
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

  const { records } = await req.json()
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

  let imported = 0
  let skippedConstraint = 0
  const errors: string[] = []

  const orgId = caller.organization_id ?? null

  // Batches of 25 (not 100): when a batch hits a 23505 (a duplicate
  // anywhere in it), every record in that batch falls back to an
  // individual insert below — a smaller batch caps how much fallback work
  // one conflict can trigger.
  const BATCH_SIZE = 25
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((r: Record<string, unknown>) => ({ ...r, organization_id: orgId }))
    const { error, data } = await admin.from('prospects').insert(batch).select('id')
    if (error) {
      if (error.code === '23505') {
        // Insert this batch one row at a time so the non-conflicting rows
        // still land — in parallel, not sequentially. A fully sequential
        // fallback (one Supabase round trip after another, up to 100 of
        // them) is what pushed a real import past the serverless function's
        // time limit: the response got cut off mid-stream, the client saw
        // "Unexpected end of JSON input", and the insert had already
        // succeeded server-side by then.
        const results = await Promise.all(
          batch.map((record: Record<string, unknown>) => admin.from('prospects').insert(record).select('id'))
        )
        for (const { error: e, data: d } of results) {
          if (!e) {
            imported += d?.length ?? 0
          } else if (e.code === '23505') {
            skippedConstraint++
          } else {
            errors.push(e.message)
          }
        }
      } else {
        errors.push(error.message)
      }
    } else {
      imported += data?.length ?? 0
    }
  }

  // Increment monthly lead counter
  if (orgId) await incrementMonthlyLeads(admin, orgId, imported)

  if (errors.length > 0 && imported === 0 && skippedConstraint === 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 })
  }

  return NextResponse.json({ ok: true, imported, skippedConstraint, errors })
}
