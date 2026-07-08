import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const userId = req.nextUrl.searchParams.get('user_id')

  let query = supabase.from('sender_profiles').select('*')

  if (userData?.role === 'admin' || userData?.role === 'admin_global') {
    query = userId ? query.eq('user_id', userId) : query.eq('organization_id', userData.organization_id)
  } else {
    query = query.eq('user_id', user.id)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  const { data: org } = await supabase
    .from('organizations')
    .select('plan')
    .eq('id', userData?.organization_id)
    .single()

  if (org?.plan === 'basic') {
    return NextResponse.json({ error: 'Sender profiles require Premium plan or above' }, { status: 403 })
  }

  const body = await req.json()
  const { display_name, title, company, style_hint, icp_focus, language, is_default, user_id: targetUserId } = body

  if (!display_name || !title || !company) {
    return NextResponse.json({ error: 'display_name, title and company are required' }, { status: 400 })
  }

  const isAdmin = userData?.role === 'admin' || userData?.role === 'admin_global'
  const profileUserId = (isAdmin && targetUserId) ? targetUserId : user.id

  if (is_default) {
    await supabase
      .from('sender_profiles')
      .update({ is_default: false })
      .eq('user_id', profileUserId)
      .eq('organization_id', userData?.organization_id)
  }

  const { data, error } = await supabase
    .from('sender_profiles')
    .insert({
      user_id: profileUserId,
      organization_id: userData?.organization_id,
      display_name,
      title,
      company,
      style_hint: style_hint ?? '',
      icp_focus: icp_focus ?? [],
      language: language ?? 'en',
      is_default: is_default ?? false,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
