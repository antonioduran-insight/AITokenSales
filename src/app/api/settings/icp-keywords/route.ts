import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { orgHasActiveAddon } from '@/lib/utils/addons'

// BD Group is a paid add-on — every route in this file is gated on it
// being active for the org, in addition to the admin-role check.
async function getOrgAdmin() {
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

  if (!profile || profile.role !== 'admin' || !profile.organization_id) return null
  if (!(await orgHasActiveAddon(profile.organization_id, 'bd_group'))) return null
  return { userId: user.id, orgId: profile.organization_id as string }
}

export async function GET() {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('org_icp_keywords')
    .select('*')
    .eq('organization_id', ctx.orgId)
    .order('category')
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { category, keyword, weight } = await req.json()
  if (!category?.trim() || !keyword?.trim()) {
    return NextResponse.json({ error: 'category and keyword are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('org_icp_keywords')
    .insert({
      organization_id: ctx.orgId,
      category: category.trim(),
      keyword: keyword.trim(),
      weight: weight ?? 1,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
