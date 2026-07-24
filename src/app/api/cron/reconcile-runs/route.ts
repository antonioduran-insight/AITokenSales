import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { assignRunLeads } from '@/lib/utils/run-assign'

/**
 * Server-side safety net for auto-assign.
 *
 * New Run's auto-assign is otherwise 100% client-driven: it only fires if the
 * browser tab that started the run is still polling /api/runs/[id] at the
 * exact moment the backend reports 'completed'. Closing the tab, navigating
 * away (the normal flow after completion sends the admin to History, not
 * back to New Run), or a backend gap that outlasts the session all mean the
 * leads sit in `scraper_leads` with `exported_to_crm = false` forever, with
 * nothing to catch it.
 *
 * This route finds exactly that: completed runs with unexported leads and an
 * UNAMBIGUOUS single SDR recipient (every run created through the normal New
 * Run flow starts with exactly one `run_sdr_assignments` row), and assigns
 * them via the same `assignRunLeads()` core logic the client calls. It is
 * idempotent and safe to run concurrently with a live client-driven assign —
 * duplicate inserts are skipped by the unique-key guard in `assignRunLeads`.
 *
 * Runs with ZERO or MORE THAN ONE `run_sdr_assignments` rows are skipped and
 * reported, never guessed at — assigning to the wrong SDR is a real business
 * cost (quota, commission, lead ownership) and this route does not have
 * enough information to reconstruct an ambiguous historical split.
 *
 * Triggered by Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET` automatically when that env var is
 * configured on the project. Can also be triggered manually with the same
 * header for an on-demand sweep.
 */

const MAX_RUNS_PER_INVOCATION = 25

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = adminClient()

  // 1. Every run with at least one unexported lead — the universe of runs
  //    that might need reconciling. (Leads on still-ACTIVE runs also show
  //    exported_to_crm=false; the status filter in step 2 excludes those.)
  const { data: stuckLeadRows, error: leadsErr } = await admin
    .from('scraper_leads')
    .select('run_id')
    .eq('exported_to_crm', false)
    .limit(5000)

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })

  const candidateRunIds = [...new Set((stuckLeadRows ?? []).map(r => r.run_id as string))]
  if (candidateRunIds.length === 0) {
    return NextResponse.json({ ok: true, processed: [], skipped_ambiguous: [], errors: [], checked: 0 })
  }

  // 2. Narrow to runs the backend actually finished.
  const completedRuns: { id: string; organization_id: string }[] = []
  for (const batch of chunk(candidateRunIds, 200)) {
    const { data, error } = await admin
      .from('runs')
      .select('id, organization_id')
      .eq('status', 'completed')
      .in('id', batch)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    completedRuns.push(...(data ?? []))
  }

  if (completedRuns.length === 0) {
    return NextResponse.json({ ok: true, processed: [], skipped_ambiguous: [], errors: [], checked: 0 })
  }

  // 3. Only runs with exactly ONE run_sdr_assignments row are unambiguous.
  //    Every run created by New Run starts with exactly one; more than one
  //    means a manual "Send to another SDR" happened, and zero means the
  //    run row itself is somehow incomplete — both need a human, not a guess.
  const runIds = completedRuns.map(r => r.id)
  const assignmentsByRun = new Map<string, { sdr_id: string; assigned_markets: string[] | null }[]>()
  for (const batch of chunk(runIds, 200)) {
    const { data, error } = await admin
      .from('run_sdr_assignments')
      .select('run_id, sdr_id, assigned_markets')
      .in('run_id', batch)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of data ?? []) {
      const list = assignmentsByRun.get(row.run_id) ?? []
      list.push({ sdr_id: row.sdr_id, assigned_markets: row.assigned_markets })
      assignmentsByRun.set(row.run_id, list)
    }
  }

  const processed: { run_id: string; sdr_id: string; assigned: number; skipped: number }[] = []
  const skippedAmbiguous: { run_id: string; sdr_count: number }[] = []
  const errors: { run_id: string; error: string }[] = []

  let handled = 0
  for (const run of completedRuns) {
    if (handled >= MAX_RUNS_PER_INVOCATION) break // next scheduled run picks up the rest

    const assignments = assignmentsByRun.get(run.id) ?? []
    if (assignments.length !== 1) {
      skippedAmbiguous.push({ run_id: run.id, sdr_count: assignments.length })
      continue
    }

    const { sdr_id, assigned_markets } = assignments[0]
    handled++
    const result = await assignRunLeads({
      admin,
      runId: run.id,
      organizationId: run.organization_id,
      sdrId: sdr_id,
      assignedMarkets: assigned_markets ?? [],
      manual: false,
    })

    if (result.ok) {
      processed.push({ run_id: run.id, sdr_id, assigned: result.assigned, skipped: result.skipped })
    } else {
      errors.push({ run_id: run.id, error: result.error })
    }
  }

  return NextResponse.json({
    ok: true,
    checked: completedRuns.length,
    processed,
    skipped_ambiguous: skippedAmbiguous,
    errors,
  })
}
