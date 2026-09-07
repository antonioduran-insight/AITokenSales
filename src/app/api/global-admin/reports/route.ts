import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

// Everything the Revenue Reports page needs in one call: all organizations, the
// active add-ons per org, and the vendor list (name + commission).
export async function GET() {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [orgsRes, addonsRes, vendorsRes, workspacesRes, activationsRes] = await Promise.all([
    admin.from('organizations').select('*').order('created_at', { ascending: false }),
    admin.from('organization_addons').select('organization_id, addon_type, is_active').eq('is_active', true),
    admin.from('vendors').select('*').order('name'),
    // Multi-workspace is billed per site, so the report needs the COUNT, not
    // just whether the add-on is on. Derived by counting rather than stored as
    // a quantity column on organization_addons: a stored number goes stale the
    // first time somebody adds a site without updating it, and then the
    // invoice and the product disagree with nobody noticing.
    admin.from('workspaces').select('organization_id').eq('is_active', true),
    // Activations of one-time add-ons (SSO today), with the date they happened.
    //
    // `organization_addons` cannot answer this: it holds current state, and its
    // `activated_at` is deliberately preserved across re-activation, so it says
    // when the add-on FIRST went on, not when it was billed. The audit trail is
    // the only record of each individual activation event, which is what a
    // one-time charge attaches to.
    //
    // Deactivations are ignored on purpose: a one-time fee was already invoiced
    // and is not refunded by switching the feature off later.
    admin.from('addon_audit_log')
      .select('organization_id, addon_type, created_at')
      .eq('action', 'activated'),
  ])

  if (orgsRes.error) return NextResponse.json({ error: orgsRes.error.message }, { status: 400 })

  const addonsByOrg = new Map<string, string[]>()
  for (const a of addonsRes.data ?? []) {
    const list = addonsByOrg.get(a.organization_id) ?? []
    list.push(a.addon_type)
    addonsByOrg.set(a.organization_id, list)
  }

  const workspaceCount = new Map<string, number>()
  for (const w of workspacesRes.data ?? []) {
    workspaceCount.set(w.organization_id, (workspaceCount.get(w.organization_id) ?? 0) + 1)
  }

  const activationsByOrg = new Map<string, { addon_type: string; created_at: string }[]>()
  for (const a of activationsRes.data ?? []) {
    const list = activationsByOrg.get(a.organization_id) ?? []
    list.push({ addon_type: a.addon_type, created_at: a.created_at })
    activationsByOrg.set(a.organization_id, list)
  }

  const orgs = (orgsRes.data ?? []).map(o => ({
    ...o,
    addons: addonsByOrg.get(o.id) ?? [],
    // 1 rather than 0 when the table has no row yet: every org conceptually
    // has its main site, and the billing formula subtracts it. Defaulting to 0
    // would make the subtraction produce -1 and credit the customer $300.
    workspace_count: workspaceCount.get(o.id) ?? 1,
    // Raw activation events; the page decides which fall inside the quarter
    // being viewed, since only it knows the selected quarter's date range.
    // Empty until the addon_audit_log migration has been run, which means a
    // one-time fee simply isn't reported rather than the page failing.
    addon_activations: activationsByOrg.get(o.id) ?? [],
  }))

  return NextResponse.json({ orgs, vendors: vendorsRes.data ?? [] })
}
