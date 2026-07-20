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

  const [orgsRes, addonsRes, vendorsRes] = await Promise.all([
    admin.from('organizations').select('*').order('created_at', { ascending: false }),
    admin.from('organization_addons').select('organization_id, addon_type, is_active').eq('is_active', true),
    admin.from('vendors').select('*').order('name'),
  ])

  if (orgsRes.error) return NextResponse.json({ error: orgsRes.error.message }, { status: 400 })

  const addonsByOrg = new Map<string, string[]>()
  for (const a of addonsRes.data ?? []) {
    const list = addonsByOrg.get(a.organization_id) ?? []
    list.push(a.addon_type)
    addonsByOrg.set(a.organization_id, list)
  }

  const orgs = (orgsRes.data ?? []).map(o => ({
    ...o,
    addons: addonsByOrg.get(o.id) ?? [],
  }))

  return NextResponse.json({ orgs, vendors: vendorsRes.data ?? [] })
}
