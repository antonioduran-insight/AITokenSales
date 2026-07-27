import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanScrapedName } from './clean-name'
import { normalizeAreaName, inferAreaFromCountry, buildMarketAreaMap } from './area-inference'

/**
 * Core "push a run's scraper leads onto an SDR's kanban board" logic, shared
 * by two callers:
 *
 * - `POST /api/runs/[id]/assign` — session-authenticated, org-scoped. Called
 *   client-side by New Run on completion, and by History's "Send to another
 *   SDR" (manual mode).
 * - `POST /api/cron/reconcile-runs` — service-role, cross-org. A periodic
 *   safety net that catches runs whose completion the client never saw (tab
 *   closed, navigated away, a backend gap that outlasted the browser's
 *   session) — auto-assign was previously 100% dependent on a live browser
 *   tab polling at the exact moment a run finished.
 *
 * Both callers must use the SAME assignment rules, so this is the single
 * source of truth — do not reimplement it inline in a route handler.
 */

export interface AssignRunParams {
  admin: SupabaseClient
  runId: string
  organizationId: string
  sdrId: string
  /** Countries to record on `run_sdr_assignments.assigned_markets`. */
  assignedMarkets: string[]
  /**
   * Manual mode ("Send to another SDR"): targets ALL of the run's leads
   * (not just unexported ones) and MOVES them — wipes existing scraper
   * copies first, doesn't flip `exported_to_crm`, doesn't bump the quota.
   * Auto mode (the default): only unexported leads, marks them exported,
   * bumps the monthly counter. Idempotent either way.
   */
  manual?: boolean
}

export type AssignRunResult =
  | { ok: true; assigned: number; queued: number; skipped: number }
  | { ok: false; status: number; error: string }

export async function assignRunLeads({
  admin, runId, organizationId, sdrId, assignedMarkets, manual = false,
}: AssignRunParams): Promise<AssignRunResult> {
  const isManual = manual === true

  // Verify run belongs to org
  const { data: run } = await admin
    .from('runs')
    .select('id, organization_id, region')
    .eq('id', runId)
    .single()

  if (!run || run.organization_id !== organizationId) {
    return { ok: false, status: 404, error: 'Run not found' }
  }

  // Auto (completion) mode → only leads not yet in the CRM.
  // Manual (Send to another SDR) mode → every lead of the run.
  let leadsQuery = admin
    .from('scraper_leads')
    .select('*')
    .eq('run_id', runId)
  if (!isManual) leadsQuery = leadsQuery.eq('exported_to_crm', false)

  const { data: leads, error: leadsError } = await leadsQuery

  if (leadsError) return { ok: false, status: 500, error: leadsError.message }
  if (!leads || leads.length === 0) {
    return {
      ok: false, status: 400,
      error: isManual ? 'This run has no leads to send' : 'No unassigned leads for this run',
    }
  }

  // Fetch the SDR's primary area so the prospects land in their kanban
  const { data: sdrRow } = await admin
    .from('users')
    .select('id, area_id, organization_id')
    .eq('id', sdrId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!sdrRow) {
    return { ok: false, status: 400, error: 'SDR not found in this organization' }
  }

  // QA-F25: a multi-region SDR's board is picked by the run's actual
  // market, not the SDR's static primary area — `sdrRow.area_id` used to be
  // used directly here, which silently misfiled every run for any SDR
  // covering more than one region. `runs.region` is the region explicitly
  // chosen in New Run's Phase 1 (the authoritative source — every market in
  // `assignedMarkets` was picked FROM that one region), so prefer it; fall
  // back to inferring from the first assigned market (via the same
  // market→area map New Run itself uses) only for older runs that predate
  // the `region` column, then to the SDR's own area as a last resort so a
  // lead is never left with no area at all.
  let resolvedAreaName = normalizeAreaName(run.region)
  if (!resolvedAreaName && assignedMarkets.length > 0) {
    const { data: marketRows } = await admin.from('markets').select('id, name, region')
    const marketAreaMap = buildMarketAreaMap(marketRows ?? [])
    resolvedAreaName = inferAreaFromCountry(assignedMarkets[0], marketAreaMap)
  }

  let sdrAreaId: string | null = sdrRow.area_id ?? null
  if (resolvedAreaName) {
    const { data: areaRow } = await admin
      .from('areas')
      .select('id')
      .eq('name', resolvedAreaName)
      .maybeSingle()
    if (areaRow) sdrAreaId = areaRow.id
  }

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
        .eq('organization_id', organizationId)
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
        .eq('organization_id', organizationId)
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
      name: cleanScrapedName(lead.full_name),
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
      organization_id: organizationId,
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
      return { ok: false, status: 500, error: error.message }
    }
    for (const row of batch) {
      const { data: one, error: rowErr } = await admin.from('prospects').insert(row).select('id')
      if (!rowErr) { inserted += one?.length ?? 0 }
      else if (!isDuplicateErr(rowErr.message)) {
        return { ok: false, status: 500, error: rowErr.message }
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
      .eq('organization_id', organizationId)
      .eq('year_month', ym)
      .maybeSingle()

    await admin
      .from('monthly_lead_counts')
      .upsert(
        {
          organization_id: organizationId,
          year_month: ym,
          count: (existing?.count ?? 0) + inserted,
        },
        { onConflict: 'organization_id,year_month' }
      )
  }

  return { ok: true, assigned: inserted, queued: assigned, skipped }
}
