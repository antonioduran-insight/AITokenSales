import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

/**
 * Wipe a demo organization's data so the account can be shown to the next
 * prospect, keeping everything that makes it a working account.
 *
 * Deleted: leads, scraped leads, runs and logs, conversations, notes, the audit
 * trail, CSV import sessions, all Bridge data, support tickets, and the monthly
 * lead counters — which also gives the account its lead quota back.
 *
 * Kept: the organization and every setting on it, users and their logins,
 * areas, sender profiles, add-ons, markets, combos, pipeline stages and
 * workspaces. Rebuilding all of that before every demo is exactly what this
 * exists to avoid.
 *
 * WHY DEMO PLANS ONLY
 * -------------------
 * This is irreversible and one click away from a customer's entire pipeline.
 * The plan check is the guard that makes an accidental click survivable: the
 * blast radius is limited to accounts that exist to be wiped. Resetting
 * anything else is still possible — call `reset_organization_data` in the SQL
 * editor — and that friction is the point, not an oversight.
 *
 * The whole delete runs inside one Postgres function, so it either all happens
 * or none of it does. Nothing here touches `auth.users`: keeping the people is
 * what keeps this transactional, since auth accounts live outside the database
 * transaction and cannot roll back with it. To remove a test SDR, delete them
 * from Users in the CRM, which handles the auth account through its own API.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: org } = await admin
    .from('organizations')
    .select('slug, plan, name')
    .eq('id', id)
    .single()

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  if (org.slug === 'aitokensales') {
    return NextResponse.json({ error: 'Cannot reset the internal organization' }, { status: 403 })
  }

  if (org.plan !== 'demo') {
    return NextResponse.json(
      {
        error:
          `Only demo organizations can be reset from here — this one is on the ` +
          `${org.plan} plan. Switch it to Demo first, or run ` +
          `reset_organization_data() in the SQL editor if you really mean to ` +
          `wipe a live account.`,
      },
      { status: 403 }
    )
  }

  const { data, error } = await admin.rpc('reset_organization_data', { p_org_id: id })

  if (error) {
    // The function is one transaction, so a failure means nothing was deleted.
    // Say so: "reset failed" on its own leaves the operator wondering whether
    // the account is now half-empty, which is the state this design prevents.
    return NextResponse.json(
      { error: `Nothing was deleted. ${error.message}` },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true, deleted: data ?? {} })
}
