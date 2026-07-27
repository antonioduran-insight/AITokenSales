import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { normalizeAnthropicBaseUrl } from '@/lib/utils/anthropic'

async function verifyGlobalAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin_global' ? user : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
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

  const [adminsRes, sdrsRes, addonsRes] = await Promise.all([
    admin.from('users').select('email').eq('organization_id', id).eq('role', 'admin').eq('is_active', true).limit(1).single(),
    admin.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', id).eq('role', 'sdr').eq('is_active', true),
    admin.from('organization_addons').select('*').eq('organization_id', id).eq('is_active', true),
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
    leads_this_month: leadsThisMonth,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const fields = await req.json()

  const allowed = ['name', 'slug', 'plan', 'max_seats', 'max_leads_per_month', 'billing_day', 'custom_price', 'vendor', 'is_active', 'internal_notes', 'logo_url', 'apify_token', 'anthropic_key', 'anthropic_base_url', 'anthropic_model']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }
  // Never store a base URL that already ends in /v1 (avoids the /v1/v1 error).
  if ('anthropic_base_url' in patch) {
    patch.anthropic_base_url = normalizeAnthropicBaseUrl(patch.anthropic_base_url as string | null)
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
  const user = await verifyGlobalAdmin()
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

  // Delete in FK-safe order
  // 1. run_sdr_assignments (references runs and users)
  const { data: orgRuns } = await admin.from('runs').select('id').eq('organization_id', id)
  if (orgRuns && orgRuns.length > 0) {
    const runIds = orgRuns.map((r: { id: string }) => r.id)
    await admin.from('run_sdr_assignments').delete().in('run_id', runIds)
  }

  // 2. runs
  await admin.from('runs').delete().eq('organization_id', id)

  // 3. sender_profiles (by organization_id or user_id)
  await admin.from('sender_profiles').delete().eq('organization_id', id)

  // 4. org_combos
  await admin.from('org_combos').delete().eq('organization_id', id)

  // 5. monthly_lead_counts
  await admin.from('monthly_lead_counts').delete().eq('organization_id', id)

  // 6. organization_addons
  await admin.from('organization_addons').delete().eq('organization_id', id)

  // 7. support_tickets (may not exist)
  try { await admin.from('support_tickets').delete().eq('organization_id', id) } catch { /* table may not exist */ }

  // 8. public users row
  if (userIds.length > 0) {
    await admin.from('users').delete().in('id', userIds)
  }

  // 9. auth users
  for (const uid of userIds) {
    try { await admin.auth.admin.deleteUser(uid) } catch { /* ignore individual failures */ }
  }

  // 10. delete organization
  const { error } = await admin.from('organizations').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
