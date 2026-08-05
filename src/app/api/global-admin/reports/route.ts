import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

async function verifyGlobalAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return profile?.role === 'admin_global' ? user : null
}

// Everything the Revenue Reports page needs in one call: all organizations, the
// active add-ons per org, and the vendor list (name + commission).
export async function GET() {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [orgsRes, addonsRes, vendorsRes, workspacesRes] = await Promise.all([
    admin.from('organizations').select('*').order('created_at', { ascending: false }),
    admin.from('organization_addons').select('organization_id, addon_type, is_active').eq('is_active', true),
    admin.from('vendors').select('*').order('name'),
    // Multi-workspace is billed per site, so the report needs the COUNT, not
    // just whether the add-on is on. Derived by counting rather than stored as
    // a quantity column on organization_addons: a stored number goes stale the
    // first time somebody adds a site without updating it, and then the
    // invoice and the product disagree with nobody noticing.
    admin.from('workspaces').select('organization_id').eq('is_active', true),
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

  const orgs = (orgsRes.data ?? []).map(o => ({
    ...o,
    addons: addonsByOrg.get(o.id) ?? [],
    // 1 rather than 0 when the table has no row yet: every org conceptually
    // has its main site, and the billing formula subtracts it. Defaulting to 0
    // would make the subtraction produce -1 and credit the customer $300.
    workspace_count: workspaceCount.get(o.id) ?? 1,
  }))

  return NextResponse.json({ orgs, vendors: vendorsRes.data ?? [] })
}
