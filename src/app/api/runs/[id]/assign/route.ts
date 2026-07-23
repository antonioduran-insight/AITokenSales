import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.organization_id || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: runId } = await params
  const body = await req.json()
  const { market, manual } = body
  // One SDR per run. `sdr_ids` still accepted (first element wins) for safety.
  const sdrId: string | null = body.sdr_id ?? body.sdr_ids?.[0] ?? null
  // New Run's Phase 1 now picks several countries within one region. Prefer
  // the full array; fall back to the legacy singular `market` (still sent by
  // History's "Send to another SDR", which only ever moves within one run's
  // original market).
  const assignedMarkets: string[] = Array.isArray(body.markets) && body.markets.length
    ? body.markets
    : (market ? [market] : [])

  if (!sdrId) {
    return NextResponse.json({ error: 'sdr_id is required' }, { status: 400 })
  }

  // Manual mode = "Send to another SDR" from History: it targets ALL leads of
  // the run (not just the not-yet-exported ones) and MOVES them to the chosen
  // SDR, without flipping exported_to_crm or bumping the monthly counter.
  const isManual = manual === true

  const admin = adminClient()

  // Verify run belongs to org
  const { data: run } = await admin
    .from('runs')
    .select('id, organization_id')
    .eq('id', runId)
    .single()

  if (!run || run.organization_id !== userData.organization_id) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  // Auto (completion) mode → only leads not yet in the CRM.
  // Manual (Send to another SDR) mode → every lead of the run.
  let leadsQuery = admin
    .from('scraper_leads')
    .select('*')
    .eq('run_id', runId)
  if (!isManual) leadsQuery = leadsQuery.eq('exported_to_crm', false)

  const { data: leads, error: leadsError } = await leadsQuery

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!leads || leads.length === 0) {
    return NextResponse.json(
      { error: isManual ? 'This run has no leads to send' : 'No unassigned leads for this run' },
      { status: 400 }
    )
  }

  // Fetch the SDR's primary area so the prospects land in their kanban
  const { data: sdrRow } = await admin
    .from('users')
    .select('id, area_id, organization_id')
    .eq('id', sdrId)
    .eq('organization_id', userData.organization_id)
    .maybeSingle()

  if (!sdrRow) {
    return NextResponse.json({ error: 'SDR not found in this organization' }, { status: 400 })
  }
  const sdrAreaId: string | null = sdrRow.area_id ?? null

  const leadUrls = [...new Set(leads.map(l => l.linkedin_url).filter(Boolean))] as string[]
  const existingKeys = new Set<string>()

  if (isManual) {
    // "Send to another SDR" = MOVE. Wipe every existing scraper copy of these
    // leads first so they end up ONLY on the newly chosen SDR, with no leftover
    // duplicate on their previous owner. Also cleans up duplicate rows from
    // earlier sends.
    for (let i = 0; i < leadUrls.length; i += 200) {
      await admin
        .from('prospects')
        .delete()
        .eq('organization_id', userData.organization_id)
        .eq('source', 'scraper')
        .in('linkedin_url', leadUrls.slice(i, i + 200))
    }
  } else if (leadUrls.length > 0) {
    // Auto-assign: a lead may already be a prospect for a given SDR (run already
    // assigned). Fetch existing (linkedin_url → assigned_to) pairs to skip those
    // inserts instead of hitting the unique key.
    for (let i = 0; i < leadUrls.length; i += 200) {
      const { data: existing } = await admin
        .from('prospects')
        .select('linkedin_url, assigned_to')
        .eq('organization_id', userData.organization_id)
        .in('linkedin_url', leadUrls.slice(i, i + 200))
      for (const p of existing ?? []) {
        if (p.linkedin_url) existingKeys.add(`${p.linkedin_url}||${p.assigned_to ?? ''}`)
      }
    }
  }

  // A run has exactly ONE SDR: every generated lead goes to them. No splitting,
  // no round-robin, and the scraper's per-lead sdr_id tag is irrelevant here.
  const prospectRows: Record<string, unknown>[] = []
  let assigned = 0
  let skipped = 0

  const tempMap: Record<string, string> = { 'HOT': 'Hot', 'WARM': 'Warm', 'COLD': 'Cold' }

  for (const lead of leads) {
    // Skip if this SDR already has this lead (avoids the duplicate-key error).
    const key = `${lead.linkedin_url ?? ''}||${sdrId}`
    if (lead.linkedin_url && existingKeys.has(key)) { skipped++; continue }
    if (lead.linkedin_url) existingKeys.add(key) // guard against in-batch dupes

    assigned++

    prospectRows.push({
      name: lead.full_name,
      linkedin_url: lead.linkedin_url ?? null,
      email: lead.email ?? null,
      company: lead.company ?? null,
      title: lead.title ?? null,
      industry: lead.industry ?? null,
      company_size: lead.company_size ?? null,
      icp_score: lead.icp_score ?? null,
      lead_temperature: tempMap[lead.temperature?.toUpperCase() ?? ''] ?? 'Cold',
      search_combo: lead.search_combo ?? null,
      custom1: lead.custom1 ?? null,
      custom2: lead.custom2 ?? null,
      market: lead.market ?? null,
      source: 'scraper',
      outreach_status: 'new',
      area_id: sdrAreaId,
      assigned_to: sdrId,
      organization_id: userData.organization_id,
      flag_tomorrow: false,
    })
  }

  // Insert prospects in batches. If a batch hits a unique-constraint conflict
  // (a lead already on that SDR's board slipping through a race), fall back to
  // row-by-row so one conflict never aborts the whole assignment.
  const isDuplicateErr = (msg: string) => /duplicate key|unique constraint/i.test(msg)
  let inserted = 0
  for (let i = 0; i < prospectRows.length; i += 100) {
    const batch = prospectRows.slice(i, i + 100)
    const { data, error } = await admin.from('prospects').insert(batch).select('id')
    if (!error) { inserted += data?.length ?? 0; continue }
    if (!isDuplicateErr(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    for (const row of batch) {
      const { data: one, error: rowErr } = await admin.from('prospects').insert(row).select('id')
      if (!rowErr) { inserted += one?.length ?? 0 }
      else if (!isDuplicateErr(rowErr.message)) {
        return NextResponse.json({ error: rowErr.message }, { status: 500 })
      } else { skipped++ }
    }
  }

  // Manual re-sends don't touch the export flag or the quota — they only move
  // the leads onto a different SDR's board.
  if (!isManual) {
    // Record the run's single SDR assignment + how many leads it got
    await admin
      .from('run_sdr_assignments')
      .upsert(
        {
          run_id: runId,
          sdr_id: sdrId,
          leads_assigned: inserted,
          assigned_markets: assignedMarkets,
        },
        { onConflict: 'run_id,sdr_id' }
      )

    // Mark these leads as exported so they aren't assigned twice
    await admin
      .from('scraper_leads')
      .update({ exported_to_crm: true })
      .eq('run_id', runId)
      .eq('exported_to_crm', false)

    // Bump the org's monthly lead counter
    const ym = new Date().toISOString().slice(0, 7)
    const { data: existing } = await admin
      .from('monthly_lead_counts')
      .select('count')
      .eq('organization_id', userData.organization_id)
      .eq('year_month', ym)
      .maybeSingle()

    await admin
      .from('monthly_lead_counts')
      .upsert(
        {
          organization_id: userData.organization_id,
          year_month: ym,
          count: (existing?.count ?? 0) + inserted,
        },
        { onConflict: 'organization_id,year_month' }
      )
  }

  return NextResponse.json({ ok: true, sdr_id: sdrId, assigned: inserted, queued: assigned, skipped })
}
