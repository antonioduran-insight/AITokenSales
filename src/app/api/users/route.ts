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

/**
 * Caller must be an admin AND belong to an organization.
 *
 * The org requirement is not decoration — this function used to return
 * `orgId: string | null`, and every caller then coped with the null in a way
 * that quietly disabled a protection:
 *   - POST skipped the seat-limit check entirely (`if (auth.orgId)`), so an
 *     org-less admin could create unlimited users;
 *   - POST then wrote `organization_id: auth.orgId ?? null`, minting ANOTHER
 *     org-less user — self-propagating, and if that user was an admin they
 *     inherited the same hole;
 *   - `isLastAdmin()` returns false for a null org, so the "an org must keep
 *     one admin" rule silently didn't apply either.
 *
 * An org-less admin (`role = 'admin'`, `organization_id = NULL` — what
 * `isGlobalAdmin()` in src/lib/supabase/server.ts calls a legacy global admin)
 * has no business managing org members through this endpoint. Global Admin has
 * its own routes for that (`/api/global-admin/create-org`, `/support-users`),
 * so refusing here breaks nothing legitimate. `admin_global` never reaches
 * this code at all — it fails the role check below.
 */
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
  if (!profile.organization_id) return null

  return { authUser: user, orgId: profile.organization_id as string }
}

/**
 * Validate a site id supplied by the client before it is written to a user.
 *
 * Returns `undefined` when the caller didn't mention a site (so the field is
 * left alone), and `null` when they explicitly cleared it. Anything that isn't
 * one of this org's own sites resolves to `null` rather than being trusted:
 * `users.workspace_id` decides what that person can see, so a client-supplied
 * id pointing at another organization's site would be a cross-tenant grant.
 */
async function resolveWorkspaceId(
  adminClient: SupabaseClient,
  raw: unknown,
  orgId: string
): Promise<string | null | undefined> {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw !== 'string') return null

  const { data } = await adminClient
    .from('workspaces')
    .select('id')
    .eq('id', raw)
    .eq('organization_id', orgId)
    .maybeSingle()

  return data ? raw : null
}

/**
 * Load the user being acted upon, but only if they are in the caller's org.
 *
 * EVERY mutating handler in this file uses the service-role client, which
 * bypasses RLS completely. Before this existed they matched on `.eq('id', id)`
 * and nothing else — so an admin of one organization holding the UUID of a
 * user in ANOTHER organization could delete their account, rename them, change
 * their role, deactivate them, or unassign all of their leads. RLS was not a
 * backstop here, because the service-role client is precisely the tool that
 * ignores it.
 *
 * Returns null when the target does not exist or belongs to someone else;
 * callers must treat both the same way and answer 404, so this endpoint cannot
 * be used to probe which UUIDs exist in other organizations.
 */
async function loadTargetInOrg(adminClient: SupabaseClient, targetId: string, orgId: string) {
  const { data } = await adminClient
    .from('users')
    .select('id, role, organization_id')
    .eq('id', targetId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return data ?? null
}

// GET /api/users — return seat info for the org
export async function GET() {
  const auth = await verifyAdminWithOrg()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Seat limit check. No longer conditional on the org existing —
  // verifyAdminWithOrg guarantees it, and the old `if (auth.orgId)` wrapper
  // meant an org-less admin skipped the seat limit altogether.
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
    // No `?? null`: verifyAdminWithOrg refuses an org-less caller, and a
    // fallback here is what created org-less users in the first place.
    organization_id: auth.orgId,
    // `?? null` here is correct and unrelated: a user with no site is
    // org-wide, which is the right default for any org that doesn't use sites.
    workspace_id: (await resolveWorkspaceId(adminClient, body.workspace_id, auth.orgId)) ?? null,
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

  // Ownership check FIRST, before any read or write touches this user. 404
  // rather than 403 for a target in another org: distinguishing "not yours"
  // from "doesn't exist" would turn this endpoint into a way to test whether
  // a given UUID is a real user somewhere else in the system.
  const profile = await loadTargetInOrg(adminClient, id, auth.orgId)
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (profile.role === 'admin' && await isLastAdmin(adminClient, profile.organization_id)) {
    return NextResponse.json({ error: 'Cannot delete the last admin. Promote another user to admin first.' }, { status: 403 })
  }

  // Belt-and-braces: `prospects.assigned_to` / `created_by` are already
  // ON DELETE SET NULL (see 20260729_user_delete_fk_policy.sql), so the
  // cascade below would unassign these anyway. Kept explicit because
  // "deleting a rep must never delete their leads" is a business rule, not
  // an incidental consequence of a constraint someone could later change.
  await adminClient.from('prospects').update({ assigned_to: null }).eq('assigned_to', id)
  await adminClient.from('prospects').update({ created_by: null }).eq('created_by', id)

  // Delete ONLY the auth account. `public.users.id` is a FK to `auth.users(id)`
  // ON DELETE CASCADE, so Postgres removes the profile row — and everything
  // cascading from it — inside the same transaction. That makes this atomic by
  // construction; there is no partial state to clean up.
  //
  // The previous version deleted the profile FIRST and the auth account second,
  // which was neither atomic nor necessary: when the second call failed, the
  // profile was already gone while the auth account survived. That orphan can
  // still authenticate (with no profile, so no role) and permanently burns its
  // email address — Supabase refuses to re-register an address that already
  // exists in auth.users. antonio@aitokensales.com was left in exactly that
  // state before this fix.
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(id)
  if (authDeleteError) {
    // `.message` comes back empty on some admin-API failures, which is why the
    // UI showed a bare `{}` with nothing actionable in it. Always send prose.
    const detail = authDeleteError.message?.trim()
    return NextResponse.json(
      { error: detail || `Could not delete the auth account (status ${authDeleteError.status ?? 'unknown'}). Nothing was deleted — try again, or check the Supabase logs.` },
      { status: 400 }
    )
  }

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

  // One ownership check covering all three branches below — 'edit',
  // 'unassign' and the is_active toggle all act on `id`, and every one of them
  // ran through the service-role client with no org scoping at all before
  // this. Deliberately placed before the branches so a new action added later
  // is covered by default rather than by remembering to add it.
  const target = await loadTargetInOrg(adminClient, id, auth.orgId)
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (action === 'edit') {
    const { full_name, role, area_ids, years_experience, seniority, expertise_area } = body

    // Demoting the org's last admin (self-change or another admin doing it)
    // would leave nobody able to promote anyone back — same protection as
    // deleting the last admin, applied before a role change instead.
    if (role === 'sdr') {
      if (target.role === 'admin' && await isLastAdmin(adminClient, target.organization_id)) {
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
    const resolvedWorkspace = await resolveWorkspaceId(adminClient, body.workspace_id, auth.orgId)
    if (resolvedWorkspace !== undefined) updates.workspace_id = resolvedWorkspace

    // The org filter is redundant given loadTargetInOrg above, and kept
    // anyway: a service-role write scoped only by id is one careless refactor
    // away from being cross-tenant again, and the guard is free here.
    const { error: updateErr } = await adminClient
      .from('users').update(updates).eq('id', id).eq('organization_id', auth.orgId)
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

  // QA-F18: the frontend used to blanket-block deactivating ANY admin,
  // regardless of whether the org had other admins — inconsistent with
  // DELETE and the role-change path above, both of which only block when
  // the target is genuinely the last one. Same real check here instead.
  if (is_active === false) {
    if (target.role === 'admin' && await isLastAdmin(adminClient, target.organization_id)) {
      const { data: org } = await adminClient.from('organizations').select('name').eq('id', target.organization_id).single()
      return NextResponse.json({
        error: `Cannot deactivate — ${org?.name ?? 'this organization'} must have at least one active admin. Promote another admin first.`,
      }, { status: 403 })
    }
  }

  const { error } = await adminClient
    .from('users').update({ is_active }).eq('id', id).eq('organization_id', auth.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
