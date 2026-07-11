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
  const { sdr_ids, sdr_market_assignments } = await req.json()

  if (!Array.isArray(sdr_ids) || sdr_ids.length === 0) {
    return NextResponse.json({ error: 'sdr_ids is required' }, { status: 400 })
  }

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

  // Fetch this run's leads that have not been pushed to the CRM yet
  const { data: leads, error: leadsError } = await admin
    .from('scraper_leads')
    .select('*')
    .eq('run_id', runId)
    .eq('exported_to_crm', false)

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!leads || leads.length === 0) {
    return NextResponse.json({ error: 'No unassigned leads for this run' }, { status: 400 })
  }

  // Fetch each SDR's primary area so prospects land in their kanban
  const { data: sdrRows } = await admin
    .from('users')
    .select('id, area_id, organization_id')
    .in('id', sdr_ids)
    .eq('organization_id', userData.organization_id)

  const validSdrs = (sdrRows ?? []).filter(s => sdr_ids.includes(s.id))
  if (validSdrs.length === 0) {
    return NextResponse.json({ error: 'No valid SDRs' }, { status: 400 })
  }
  const areaBySdr: Record<string, string | null> = {}
  for (const s of validSdrs) areaBySdr[s.id] = s.area_id ?? null

  // Assign each lead to the SDR the scraper already tagged it with (lead.sdr_id).
  // Leads with no sdr_id — or an sdr_id that isn't in this run's SDR list — fall
  // back to the first SDR.
  const validSdrIds = new Set(validSdrs.map(s => s.id))
  const fallbackSdrId = validSdrs[0].id

  const prospectRows: Record<string, unknown>[] = []
  const assignedCount: Record<string, number> = {}
  for (const s of validSdrs) assignedCount[s.id] = 0

  const tempMap: Record<string, string> = { 'HOT': 'Hot', 'WARM': 'Warm', 'COLD': 'Cold' }

  for (const lead of leads) {
    const sdrId = lead.sdr_id && validSdrIds.has(lead.sdr_id) ? lead.sdr_id : fallbackSdrId
    assignedCount[sdrId] = (assignedCount[sdrId] ?? 0) + 1

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
      area_id: areaBySdr[sdrId],
      assigned_to: sdrId,
      organization_id: userData.organization_id,
      flag_tomorrow: false,
    })
  }

  // Insert prospects in batches
  let inserted = 0
  for (let i = 0; i < prospectRows.length; i += 100) {
    const batch = prospectRows.slice(i, i + 100)
    const { data, error } = await admin.from('prospects').insert(batch).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    inserted += data?.length ?? 0
  }

  // Record per-SDR assignment counts (and the markets each SDR was assigned)
  for (const sdrId of Object.keys(assignedCount)) {
    await admin
      .from('run_sdr_assignments')
      .upsert(
        {
          run_id: runId,
          sdr_id: sdrId,
          leads_assigned: assignedCount[sdrId],
          assigned_markets: sdr_market_assignments?.[sdrId] ?? [],
        },
        { onConflict: 'run_id,sdr_id' }
      )
  }

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

  return NextResponse.json({ ok: true, assigned: inserted, per_sdr: assignedCount })
}
