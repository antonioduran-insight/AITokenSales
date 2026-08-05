import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Manage the sites (branch offices) inside one organization.
 *
 * A workspace is a partition WITHIN an org — an Enterprise customer with an
 * office in Taiwan and another in Hong Kong. It is orthogonal to markets: two
 * sites can work the same territory.
 *
 * THREE GATES, AND WHY EACH IS SEPARATE
 * -------------------------------------
 *   1. Role must be `admin`.
 *   2. The caller must be the ORG-WIDE admin (`workspace_id IS NULL`). A site
 *      admin managing sites could create one and move themselves into it,
 *      which defeats the partition they are supposed to be confined by.
 *   3. The org must have the `multi_workspace` add-on active.
 *
 * Gate 3 is re-checked here and not merely hidden in the UI, on the same
 * principle the Bridge proxy follows: UI gating is never the security
 * boundary. Reads are exempt from gate 3 — an org that once had the add-on and
 * let it lapse must still be able to SEE the sites its data is sitting in,
 * otherwise the CRM becomes unexplainable to its own admin.
 */

type Caller = { id: string; organizationId: string; isOrgWideAdmin: boolean }

async function getCaller(): Promise<Caller | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, organization_id, workspace_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' || !profile.organization_id) return null

  return {
    id: user.id,
    organizationId: profile.organization_id as string,
    isOrgWideAdmin: profile.workspace_id === null,
  }
}

async function hasAddon(organizationId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_addons')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('addon_type', 'multi_workspace')
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}

// GET /api/workspaces — list this org's sites, with how many people are in each.
export async function GET() {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [wsRes, usersRes, addonActive] = await Promise.all([
    admin.from('workspaces').select('*')
      .eq('organization_id', caller.organizationId)
      .order('created_at', { ascending: true }),
    admin.from('users').select('workspace_id')
      .eq('organization_id', caller.organizationId)
      .not('workspace_id', 'is', null),
    hasAddon(caller.organizationId),
  ])

  if (wsRes.error) return NextResponse.json({ error: wsRes.error.message }, { status: 500 })

  const memberCount: Record<string, number> = {}
  for (const u of usersRes.data ?? []) {
    const w = u.workspace_id as string
    memberCount[w] = (memberCount[w] ?? 0) + 1
  }

  return NextResponse.json({
    workspaces: (wsRes.data ?? []).map(w => ({ ...w, member_count: memberCount[w.id] ?? 0 })),
    addon_active: addonActive,
    can_manage: caller.isOrgWideAdmin,
  })
}

// POST /api/workspaces — create a site.
export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOrgWideAdmin) {
    return NextResponse.json({ error: 'Only an organization-wide admin can manage sites.' }, { status: 403 })
  }
  if (!await hasAddon(caller.organizationId)) {
    return NextResponse.json({ error: 'The Multi-workspace add-on is not active for this organization.' }, { status: 403 })
  }

  const { name } = await req.json()
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('workspaces')
    .insert({ organization_id: caller.organizationId, name: trimmed })
    .select()
    .single()

  if (error) {
    // 23505 is the UNIQUE (organization_id, name) constraint. Answering with
    // the actual reason matters: "Hong Kong already exists" is actionable,
    // whereas a generic failure invites the admin to retry the same thing.
    if (error.code === '23505') {
      return NextResponse.json({ error: `A site called “${trimmed}” already exists.` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ workspace: { ...data, member_count: 0 } })
}

// PATCH /api/workspaces — rename, or activate/deactivate.
export async function PATCH(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOrgWideAdmin) {
    return NextResponse.json({ error: 'Only an organization-wide admin can manage sites.' }, { status: 403 })
  }

  const { id, name, is_active } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof is_active === 'boolean') updates.is_active = is_active
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Scoped by organization_id as well as id: this is the service-role client,
  // so RLS is not protecting anything here and matching on id alone would let
  // one org rename another's sites.
  const { data, error } = await admin
    .from('workspaces')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', caller.organizationId)
    .select()
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Another site already uses that name.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (!data) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  return NextResponse.json({ workspace: data })
}

// DELETE /api/workspaces — remove a site.
export async function DELETE(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.isOrgWideAdmin) {
    return NextResponse.json({ error: 'Only an organization-wide admin can manage sites.' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()

  // Refuse while anyone still works there. The FK is ON DELETE SET NULL, so
  // deleting would silently promote every member to org-wide visibility —
  // the opposite of what a partition is for, and invisible until someone
  // notices a rep browsing another site's leads. Making the admin empty the
  // site first turns a silent permission widening into a deliberate act.
  //
  // Leads are NOT a blocker: their workspace_id going null just returns them
  // to org-wide, where the org admin can still see and reassign them.
  const { count } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', caller.organizationId)
    .eq('workspace_id', id)

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `This site still has ${count} member(s). Move them to another site first.` },
      { status: 409 }
    )
  }

  const { error } = await admin
    .from('workspaces')
    .delete()
    .eq('id', id)
    .eq('organization_id', caller.organizationId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
