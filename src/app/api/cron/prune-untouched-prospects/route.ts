import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * Data retention: delete prospects nobody ever worked, for orgs without the
 * `extended_data_retention` add-on.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A `delete_old_leads()` SQL function has existed since 20260702_multi_market
 * doing `DELETE FROM prospects WHERE created_at < now() - interval '3 months'`.
 * It was never scheduled (pg_cron is not enabled), and it was broken in two
 * separate ways that only became visible on inspection:
 *
 *   1. No add-on exclusion. Its own comment says to add one "after the
 *      organization_addons table is available". That never happened, so an org
 *      paying for Extended Data Retention would have been pruned like any
 *      other — the add-on would have been sold and then ignored.
 *   2. `audit_log.prospect_id` references prospects with ON DELETE NO ACTION.
 *      Deleting a prospect that has any audit history raises a foreign-key
 *      violation, and since it was one statement the whole DELETE would abort.
 *      Enabling that cron would not have destroyed data; it would have failed
 *      silently at 03:00 every day.
 *
 * WHAT "UNTOUCHED" MEANS, AND WHY IT IS NARROW
 * -------------------------------------------
 * Deleting by age alone treats two very different things the same way: a
 * scraped lead nobody ever contacted is accumulated noise, while a deal closed
 * four months ago is the customer's record of a sale. Only the first is
 * deleted here. A prospect is eligible only when ALL of these hold:
 *
 *   - outreach_status = 'new'  (never moved out of the first column)
 *   - no rows in `conversations` (CASCADE — deleting would take the chat that
 *     CloseDealModal forces reps to upload)
 *   - no rows in `notes` (CASCADE — same reasoning)
 *   - no rows in `audit_log` (NO ACTION — would block the delete anyway, and
 *     its presence means a human acted on this lead: assignRunLeads writes no
 *     audit rows, so a purely scraped, never-touched lead has none)
 *   - older than RETENTION_MONTHS
 *   - its org does not have `extended_data_retention` active
 *
 * 'nurture' is deliberately NOT included even though it looks idle: parking a
 * lead for later is an explicit decision by a rep, and deleting it would throw
 * away the follow-up they scheduled. If that turns out to be too conservative
 * it is one line to change — but the safe default for a destructive job is to
 * delete less than asked, not more.
 *
 * SAFETY
 * ------
 * Every child-table lookup FAILS CLOSED: if a query errors, its candidates are
 * treated as touched and skipped rather than deleted. A transient database
 * error must never widen the deletion set.
 *
 * Call with `?dry_run=1` to get the exact same report without deleting
 * anything. Do that before scheduling this in vercel.json.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`, same as /api/cron/reconcile-runs.
 */

// Baseline retention. The add-on's promise is "we never delete your data", so
// there is no second, longer window to configure — an org either has the
// add-on and is skipped entirely, or it doesn't and this window applies.
const RETENTION_MONTHS = 3

// Bounded so one invocation can't run long enough to be killed mid-way. The
// job is idempotent and runs daily, so leftovers are picked up tomorrow.
const MAX_DELETIONS_PER_INVOCATION = 500

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

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const admin = adminClient()

  // Window override, accepted ONLY in dry-run. Without it this logic can't be
  // exercised until the oldest data actually crosses RETENTION_MONTHS, which
  // means shipping a destructive job whose selection has never once been
  // observed against real rows. `?dry_run=1&months=0` shows exactly what would
  // go, today. Ignored outside dry-run so no caller can ever widen a real
  // deletion window from the URL.
  const monthsParam = Number(req.nextUrl.searchParams.get('months'))
  const months =
    dryRun && Number.isFinite(monthsParam) && monthsParam >= 0
      ? monthsParam
      : RETENTION_MONTHS

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffIso = cutoff.toISOString()

  // 1. Orgs that bought their way out of this entirely.
  const { data: exemptRows, error: exemptErr } = await admin
    .from('organization_addons')
    .select('organization_id')
    .eq('addon_type', 'extended_data_retention')
    .eq('is_active', true)

  // Fail closed: without a reliable exemption list, deleting anything risks
  // deleting from an org that paid not to be deleted from.
  if (exemptErr) {
    return NextResponse.json(
      { error: `could not read add-on exemptions, aborting: ${exemptErr.message}` },
      { status: 500 }
    )
  }
  const exemptOrgs = new Set((exemptRows ?? []).map(r => r.organization_id as string))

  // 2. Candidates by age and status. `organization_id` is selected so the
  //    report can be read per-org and so exempt orgs can be filtered out here
  //    rather than trusting a join.
  const { data: candidates, error: candErr } = await admin
    .from('prospects')
    .select('id, organization_id')
    .eq('outreach_status', 'new')
    .lt('created_at', cutoffIso)
    .limit(5000)

  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 500 })

  const eligible = (candidates ?? []).filter(
    p => p.organization_id && !exemptOrgs.has(p.organization_id as string)
  )

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true, dry_run: dryRun, cutoff: cutoffIso,
      exempt_orgs: exemptOrgs.size,
      candidates: candidates?.length ?? 0,
      deleted: 0, kept_because_touched: 0, by_org: {},
    })
  }

  // 3. Anything with a child row was worked on by a human. Collected across
  //    all three tables before deleting anything, so a prospect referenced by
  //    only one of them is still protected.
  const candidateIds = eligible.map(p => p.id as string)
  const touched = new Set<string>()
  const lookupFailures: string[] = []

  for (const table of ['conversations', 'notes', 'audit_log'] as const) {
    for (const batch of chunk(candidateIds, 200)) {
      const { data, error } = await admin
        .from(table)
        .select('prospect_id')
        .in('prospect_id', batch)

      if (error) {
        // Fail closed for this batch: treat every id in it as touched.
        lookupFailures.push(`${table}: ${error.message}`)
        batch.forEach(id => touched.add(id))
        continue
      }
      for (const row of data ?? []) {
        if (row.prospect_id) touched.add(row.prospect_id as string)
      }
    }
  }

  const deletable = candidateIds.filter(id => !touched.has(id))
  const toDelete = deletable.slice(0, MAX_DELETIONS_PER_INVOCATION)

  // Per-org tally, so the report answers "whose data did this remove" without
  // needing a second query.
  const orgOf = new Map(eligible.map(p => [p.id as string, p.organization_id as string]))
  const byOrg: Record<string, number> = {}
  for (const id of toDelete) {
    const org = orgOf.get(id)
    if (org) byOrg[org] = (byOrg[org] ?? 0) + 1
  }

  let deleted = 0
  const errors: string[] = []

  if (!dryRun) {
    for (const batch of chunk(toDelete, 200)) {
      const { error } = await admin.from('prospects').delete().in('id', batch)
      if (error) {
        // Loud on purpose. A retention job that quietly half-worked is how you
        // end up unable to answer "was this lead deleted or never created".
        console.error(`[retention] batch delete failed: ${error.message}`)
        errors.push(error.message)
        continue
      }
      deleted += batch.length
    }
    if (deleted > 0) {
      console.log(
        `[retention] deleted ${deleted} untouched prospects older than ` +
        `${RETENTION_MONTHS} months across ${Object.keys(byOrg).length} org(s)`
      )
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    cutoff: cutoffIso,
    retention_months: months,
    retention_months_default: RETENTION_MONTHS,
    exempt_orgs: exemptOrgs.size,
    candidates: candidates?.length ?? 0,
    eligible_after_addon_filter: eligible.length,
    kept_because_touched: candidateIds.length - deletable.length,
    would_delete: dryRun ? toDelete.length : undefined,
    deleted: dryRun ? 0 : deleted,
    capped: deletable.length > MAX_DELETIONS_PER_INVOCATION,
    by_org: byOrg,
    lookup_failures: lookupFailures,
    errors,
  })
}
