import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const isAdmin = userData?.role === 'admin' || userData?.role === 'admin_global'

  const { id } = await params
  const body = await req.json()

  const allowed = ['display_name', 'title', 'company', 'style_hint', 'icp_focus', 'language', 'is_default', 'is_active', 'linkedin_account_tier', 'connection_note_max_chars', 'followup_max_chars']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  const writer = isAdmin ? createAdminClient() : supabase

  if (patch.is_default) {
    const { data: profile } = await writer
      .from('sender_profiles')
      .select('user_id, organization_id')
      .eq('id', id)
      .maybeSingle()
    if (profile) {
      await writer
        .from('sender_profiles')
        .update({ is_default: false })
        .eq('user_id', profile.user_id)
        .eq('organization_id', profile.organization_id)
    }
  }

  let query = writer.from('sender_profiles').update(patch).eq('id', id)
  if (!isAdmin) {
    query = query.eq('user_id', user.id)
  } else {
    query = query.eq('organization_id', userData?.organization_id)
  }

  const { data, error } = await query.select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const isAdmin = userData?.role === 'admin' || userData?.role === 'admin_global'

  const { id } = await params
  const deleter = isAdmin ? createAdminClient() : supabase

  let query = deleter.from('sender_profiles').delete().eq('id', id)
  if (!isAdmin) {
    query = query.eq('user_id', user.id)
  } else {
    query = query.eq('organization_id', userData?.organization_id)
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
