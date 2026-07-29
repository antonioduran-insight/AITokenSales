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

  if (!profile) return null
  const role = profile.role as string
  // support/admin_global are org-independent by design (organization_id is
  // null) — every other role needs a real org to be scoped to.
  if (!profile.organization_id && role !== 'support' && role !== 'admin_global') return null
  return { userId: user.id, role, orgId: profile.organization_id as string | null }
}

export async function GET() {
  const ctx = await getAuthUser()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const isCrossOrg = ctx.role === 'support' || ctx.role === 'admin_global'

  let query = admin
    .from('support_tickets')
    .select('*, messages:support_ticket_messages(*), organization:organizations(id, name)')
    .order('created_at', { ascending: false })

  if (isCrossOrg) {
    // support/admin_global see every org's tickets — that's the whole point
    // of the role, no organization_id filter at all.
  } else {
    query = query.eq('organization_id', ctx.orgId)
    if (ctx.role !== 'admin') query = query.eq('created_by', ctx.userId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const tickets = data ?? []

  // created_by/support_ticket_messages.created_by reference auth.users, not
  // public.users, so PostgREST can't embed a name via FK — resolve names
  // with one follow-up lookup instead.
  //
  // `created_by` is nullable since 20260729_support_fk_auth_users.sql (deleting
  // a user nulls it rather than destroying the support history), so skip nulls
  // here — letting one into the Set would put an empty element inside the
  // `.in(...)` filter below, which PostgREST does not parse as "no value".
  const userIds = new Set<string>()
  tickets.forEach(t => {
    if (t.created_by) userIds.add(t.created_by)
    ;(t.messages ?? []).forEach((m: { created_by: string | null }) => {
      if (m.created_by) userIds.add(m.created_by)
    })
  })
  const { data: authors } = userIds.size > 0
    ? await admin.from('users').select('id, full_name').in('id', Array.from(userIds))
    : { data: [] as { id: string; full_name: string }[] }
  const nameMap = new Map((authors ?? []).map(u => [u.id, u.full_name]))

  const enriched = tickets.map(t => ({
    ...t,
    created_by_user: { id: t.created_by, full_name: nameMap.get(t.created_by) ?? 'Unknown' },
    messages: (t.messages ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      author_name: nameMap.get(m.created_by as string) ?? 'Unknown',
    })),
  }))

  return NextResponse.json(enriched)
}

export async function POST(req: Request) {
  const ctx = await getAuthUser()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.orgId) {
    return NextResponse.json({ error: 'Support and Global Admin accounts cannot file tickets.' }, { status: 400 })
  }

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
    .select('*, messages:support_ticket_messages(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
