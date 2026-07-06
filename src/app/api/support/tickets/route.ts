import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

async function getAuthUser() {
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

  if (!profile?.organization_id) return null
  return { userId: user.id, role: profile.role as string, orgId: profile.organization_id as string }
}

export async function GET() {
  const ctx = await getAuthUser()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = admin
    .from('support_tickets')
    .select('*, messages:support_ticket_messages(*), created_by_user:users!created_by(id, full_name)')
    .eq('organization_id', ctx.orgId)
    .order('created_at', { ascending: false })

  if (ctx.role !== 'admin') {
    query = query.eq('created_by', ctx.userId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const ctx = await getAuthUser()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subject, description, priority } = await req.json()
  if (!subject?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'subject and description required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('support_tickets')
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.userId,
      subject: subject.trim(),
      description: description.trim(),
      priority: priority ?? 'medium',
      status: 'open',
    })
    .select('*, messages:support_ticket_messages(*), created_by_user:users!created_by(id, full_name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
