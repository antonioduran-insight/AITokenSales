import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { assignRunLeads } from '@/lib/utils/run-assign'

/**
 * Server-to-server webhook: the scraper backend (or a Supabase Database
 * Webhook on `runs` for status → 'completed') calls this the moment a run
 * finishes, so assignment no longer depends on a browser tab polling at the
 * right moment. This is the PRIMARY assign path; New Run's client-side
 * optimistic assign and the daily `/api/cron/reconcile-runs` sweep both still
 * run — all three share `assignRunLeads()`'s idempotent insert, so racing is
 * safe and none of them needs to know about the others.
 *
 * Auth: `X-Internal-Api-Key` — the same shared secret already used for every
 * CRM→backend call (see `backendHeaders()`), reused here for the reverse
 * direction so no new secret has to be provisioned. Fails closed if the env
 * var isn't set, matching the cron's `CRON_SECRET` check.
 *
 * No body is required or trusted — the caller only identifies the run by id.
 * The SDR, org and markets are all resolved from `run_sdr_assignments`
 * (written server-side at run creation), never from the request payload.
 */

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
  const secret = process.env.INTERNAL_API_KEY
  const provided = req.headers.get('x-internal-api-key')
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: runId } = await params
  const admin = adminClient()

  const { data: run } = await admin
    .from('runs')
    .select('id, organization_id')
    .eq('id', runId)
    .maybeSingle()

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // Only an unambiguous single SDR recipient is safe to act on — same rule as
  // the cron reconciler. Zero or multiple rows need a human, not a guess.
  const { data: assignments, error: assignErr } = await admin
    .from('run_sdr_assignments')
    .select('sdr_id, assigned_markets')
    .eq('run_id', runId)

  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 })

  if (!assignments || assignments.length !== 1) {
    return NextResponse.json({
      ok: false,
      skipped: 'ambiguous',
      sdr_count: assignments?.length ?? 0,
      run_id: runId,
    }, { status: 200 })
  }

  const { sdr_id, assigned_markets } = assignments[0]
  const result = await assignRunLeads({
    admin,
    runId,
    organizationId: run.organization_id,
    sdrId: sdr_id,
    assignedMarkets: assigned_markets ?? [],
    manual: false,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, sdr_id, assigned: result.assigned, queued: result.queued, skipped: result.skipped })
}
