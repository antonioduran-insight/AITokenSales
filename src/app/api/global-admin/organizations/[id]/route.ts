import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { normalizeAnthropicBaseUrl } from '@/lib/utils/anthropic'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

export async function GET(
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

  const { data: org, error } = await admin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !org) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })

  const [adminsRes, sdrsRes, addonsRes, addonHistoryRes] = await Promise.all([
    admin.from('users').select('email').eq('organization_id', id).eq('role', 'admin').eq('is_active', true).limit(1).single(),
    admin.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', id).eq('role', 'sdr').eq('is_active', true),
    admin.from('organization_addons').select('*').eq('organization_id', id).eq('is_active', true),
    // Internal-only trail of who turned each add-on on/off and when.
    // `organization_addons` above is current state only, so without this a
    // billing question about a past period has no answer. Capped because this
    // is a sidebar-sized panel, not a full log viewer.
    admin.from('addon_audit_log').select('*').eq('organization_id', id)
      .order('created_at', { ascending: false }).limit(50),
  ])

  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { data: leadCountRow } = await admin
    .from('monthly_lead_counts')
    .select('count')
    .eq('organization_id', id)
    .eq('year_month', yearMonth)
    .single()
  const leadsThisMonth = leadCountRow?.count ?? 0

  return NextResponse.json({
    ...org,
    admin_email: adminsRes.data?.email ?? null,
    sdr_count: sdrsRes.count ?? 0,
    addons: addonsRes.data ?? [],
    // Empty rather than absent when the migration hasn't been run yet, so the
    // panel renders "no history" instead of the page failing to load.
    addon_history: addonHistoryRes.data ?? [],
    leads_this_month: leadsThisMonth,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const fields = await req.json()

  const allowed = ['name', 'slug', 'plan', 'max_seats', 'max_leads_per_month', 'billing_day', 'custom_price', 'vendor', 'is_active', 'internal_notes', 'logo_url', 'apify_token', 'anthropic_key', 'anthropic_base_url', 'anthropic_model', 'sso_provider_id', 'sso_domains']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }
  // Never store a base URL that already ends in /v1 (avoids the /v1/v1 error).
  if ('anthropic_base_url' in patch) {
    patch.anthropic_base_url = normalizeAnthropicBaseUrl(patch.anthropic_base_url as string | null)
  }

  // SSO domains are matched against the domain of an email at login, which is
  // always lowercase — a stored `Acme.com` would silently never match and the
  // org's people would be offered a password field instead of their IdP.
  // Blanks are dropped rather than stored: an empty string in the array would
  // make `contains(['',...])` behave unpredictably.
  if ('sso_domains' in patch) {
    const raw = patch.sso_domains
    patch.sso_domains = Array.isArray(raw)
      ? [...new Set(raw.map(d => String(d).trim().toLowerCase()).filter(Boolean))]
      : []
  }

  // An empty string from a cleared input is not a uuid, and Postgres would
  // reject the whole PATCH with a type error rather than clearing the field.
  if ('sso_provider_id' in patch && !patch.sso_provider_id) {
    patch.sso_provider_id = null
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // QA-F3: admin_email/admin_password aren't organizations columns — they
  // belong to the org's admin user (Supabase Auth + the mirrored email on
  // public.users, same two-places-at-once pattern create-org uses when
  // first creating that user). Resolved and updated separately from the
  // organizations patch below.
  if ('admin_email' in fields || 'admin_password' in fields) {
    const { data: adminUser, error: adminLookupError } = await admin
      .from('users')
      .select('id, email')
      .eq('organization_id', id)
      .eq('role', 'admin')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (adminLookupError || !adminUser) {
      return NextResponse.json({ error: 'This organization has no active admin to update.' }, { status: 400 })
    }

    const authUpdate: { email?: string; password?: string } = {}
    if (fields.admin_email && fields.admin_email !== adminUser.email) authUpdate.email = fields.admin_email
    if (fields.admin_password) authUpdate.password = fields.admin_password

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await admin.auth.admin.updateUserById(adminUser.id, authUpdate)
      if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

      if (authUpdate.email) {
        const { error: emailSyncError } = await admin.from('users').update({ email: authUpdate.email }).eq('id', adminUser.id)
        if (emailSyncError) return NextResponse.json({ error: emailSyncError.message }, { status: 400 })
      }
    }
  }

  // A request updating only admin_email/admin_password has nothing left for
  // the organizations table — skip the update rather than sending an empty
  // SET clause.
  if (Object.keys(patch).length === 0) {
    const { data, error } = await admin.from('organizations').select('*').eq('id', id).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  }

  const { data, error } = await admin
    .from('organizations')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(
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

  const { data: org } = await admin.from('organizations').select('slug').eq('id', id).single()
  if (org?.slug === 'aitokensales') {
    return NextResponse.json({ error: 'Cannot delete internal organization' }, { status: 403 })
  }

  // Get all user IDs before deleting
  const { data: orgUsers } = await admin.from('users').select('id').eq('organization_id', id)
  const userIds = (orgUsers ?? []).map((u: { id: string }) => u.id)

  // Everything in the database goes in ONE transaction.
  //
  // This used to be fifteen sequential deletes over HTTP, ending with the
  // organization itself. Six tables that reference `organizations` with
  // ON DELETE NO ACTION were missing from that list (prospects, audit_log,
  // conversations, notes, areas, csv_import_sessions), so any org with a
  // single lead failed on the very last statement — by which point its users
  // and their auth accounts had already been deleted three steps earlier.
  //
  // The result was a half-destroyed organization: leads intact, nobody left
  // who could log in and reach them. `testorg` was left in exactly that state
  // on 05/08/2026. Separate HTTP calls cannot be rolled back; a function can.
  const { error: rpcError } = await admin.rpc('delete_organization', { p_org_id: id })
  if (rpcError) {
    return NextResponse.json(
      { error: `Nothing was deleted. ${rpcError.message}` },
      { status: 400 }
    )
  }

  // Auth accounts last, and only once the transaction above has committed.
  //
  // The Supabase Auth admin API can't join that transaction, so one of the two
  // has to go first. This order is the safe one: an auth account left behind
  // for an org that no longer exists is an inert orphan, while the reverse —
  // deleted logins for an org that still exists — is precisely the failure
  // being fixed here.
  //
  // Individual failures are collected rather than thrown: the organization is
  // already gone, so aborting here would just hide which accounts survived.
  const orphanedAuthAccounts: string[] = []
  for (const uid of userIds) {
    const { error: authErr } = await admin.auth.admin.deleteUser(uid)
    if (authErr) orphanedAuthAccounts.push(uid)
  }

  if (orphanedAuthAccounts.length > 0) {
    // Loud, because a surviving auth account permanently burns its email
    // address — Supabase refuses to register an address that already exists,
    // so the person could never be re-invited under it.
    console.error(
      `[delete-org] org ${id} deleted, but ${orphanedAuthAccounts.length} auth account(s) ` +
      `could not be removed and now block their email addresses: ${orphanedAuthAccounts.join(', ')}`
    )
  }

  return NextResponse.json({ ok: true, orphaned_auth_accounts: orphanedAuthAccounts.length })
}
