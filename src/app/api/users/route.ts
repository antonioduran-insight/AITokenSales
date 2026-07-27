import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared by DELETE (removing a user) and PATCH's 'edit' action (changing a
// user's role away from admin) — an org must always keep at least one admin,
// or nobody is left with permission to fix it. Mirrors the org-wide admin
// count check that already existed for delete, so both paths agree on what
// "last admin" means (role = 'admin' in this org, regardless of is_active).
async function isLastAdmin(adminClient: SupabaseClient, organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false
  const { count } = await adminClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('role', 'admin')
  return (count ?? 0) <= 1
}

async function verifyAdminWithOrg() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return null
  return { authUser: user, orgId: profile.organization_id as string | null }
}

// GET /api/users — return seat info for the org
export async function GET() {
  const auth = await verifyAdminWithOrg()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!auth.orgId) return NextResponse.json({ max_seats: 999, active_sdrs: 0 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [orgResult, sdrResult] = await Promise.all([
    adminClient.from('organizations').select('max_seats').eq('id', auth.orgId).single(),
    adminClient
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('role', 'sdr')
      .eq('is_active', true),
  ])

  return NextResponse.json({
    max_seats: orgResult.data?.max_seats ?? 999,
    active_sdrs: sdrResult.count ?? 0,
  })
}

// POST /api/users — create a new SDR
export async function POST(req: NextRequest) {
  const auth = await verifyAdminWithOrg()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { full_name, email, password, area_id, area_ids } = body

  if (!full_name || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Seat limit check
  if (auth.orgId) {
    const [orgRes, countRes] = await Promise.all([
      adminClient.from('organizations').select('max_seats').eq('id', auth.orgId).single(),
      adminClient
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', auth.orgId)
        .eq('role', 'sdr')
        .eq('is_active', true),
    ])
    const maxSeats = orgRes.data?.max_seats ?? 999
    const activeSdrs = countRes.count ?? 0
    if (activeSdrs >= maxSeats) {
      return NextResponse.json({ error: 'seat_limit_reached', max_seats: maxSeats }, { status: 409 })
    }
  }

  // Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'Failed to create user' }, { status: 400 })
  }

  // Resolve primary area_id: prefer first from area_ids array, then legacy area_id
  const resolvedAreaIds: string[] = area_ids?.length ? area_ids : (area_id ? [area_id] : [])
  const primaryAreaId = resolvedAreaIds[0] ?? null

  // Insert into public.users
  const { error: profileError } = await adminClient.from('users').insert({
    id: authData.user.id,
    full_name,
    email,
    role: body.role === 'admin' ? 'admin' : 'sdr',
    area_id: primaryAreaId,
    organization_id: auth.orgId ?? null,
    is_active: true,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // Insert user_areas entries for all selected areas
  if (resolvedAreaIds.length > 0) {
    await adminClient.from('user_areas').insert(
      resolvedAreaIds.map(aid => ({ user_id: authData.user.id, area_id: aid }))
    )
  }

  return NextResponse.json({ id: authData.user.id })
}

// DELETE /api/users — permanently delete an SDR
export async function DELETE(req: NextRequest) {
  const auth = await verifyAdminWithOrg()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await adminClient.from('users').select('role, organization_id').eq('id', id).single()
  if (profile?.role === 'admin' && await isLastAdmin(adminClient, profile.organization_id)) {
    return NextResponse.json({ error: 'Cannot delete the last admin. Promote another user to admin first.' }, { status: 403 })
  }

  await adminClient.from('prospects').update({ assigned_to: null }).eq('assigned_to', id)
  await adminClient.from('prospects').update({ created_by: null }).eq('created_by', id)

  const { error: profileDeleteError } = await adminClient.from('users').delete().eq('id', id)
  if (profileDeleteError) return NextResponse.json({ error: profileDeleteError.message }, { status: 400 })

  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(id)
  if (authDeleteError) return NextResponse.json({ error: authDeleteError.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

// PATCH /api/users — toggle active status OR unassign all leads
export async function PATCH(req: NextRequest) {
  const auth = await verifyAdminWithOrg()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, is_active, action } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (action === 'edit') {
    const { full_name, role, area_ids, years_experience, seniority, expertise_area } = body

    // Demoting the org's last admin (self-change or another admin doing it)
    // would leave nobody able to promote anyone back — same protection as
    // deleting the last admin, applied before a role change instead.
    if (role === 'sdr') {
      const { data: target } = await adminClient.from('users').select('role, organization_id').eq('id', id).single()
      if (target?.role === 'admin' && await isLastAdmin(adminClient, target.organization_id)) {
        const { data: org } = await adminClient.from('organizations').select('name').eq('id', target.organization_id).single()
        return NextResponse.json({
          error: `Cannot change role — ${org?.name ?? 'this organization'} must have at least one admin. Assign another admin first.`,
        }, { status: 403 })
      }
    }

    const updates: Record<string, unknown> = {}
    if (full_name) updates.full_name = full_name.trim()
    if (role === 'admin' || role === 'sdr') updates.role = role
    if (area_ids !== undefined) {
      if (area_ids.length > 0) updates.area_id = area_ids[0]
      else updates.area_id = null
    }
    if (years_experience !== undefined) updates.years_experience = years_experience
    if (seniority !== undefined) updates.seniority = seniority || null
    if (expertise_area !== undefined) updates.expertise_area = expertise_area ? expertise_area.trim() : null

    const { error: updateErr } = await adminClient.from('users').update(updates).eq('id', id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 })

    if (area_ids !== undefined) {
      await adminClient.from('user_areas').delete().eq('user_id', id)
      if (area_ids.length > 0) {
        await adminClient.from('user_areas').insert(area_ids.map((aid: string) => ({ user_id: id, area_id: aid })))
      }
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'unassign') {
    const { count } = await adminClient
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', id)
    const { error } = await adminClient
      .from('prospects')
      .update({ assigned_to: null })
      .eq('assigned_to', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, count: count ?? 0 })
  }

  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'Missing is_active or action' }, { status: 400 })
  }

  const { error } = await adminClient.from('users').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
