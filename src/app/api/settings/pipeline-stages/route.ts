import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

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
  return { userId: user.id, orgId: profile.organization_id as string }
}

// GET — list this org's 7 stages (one per outreach_status), ordered by position
export async function GET() {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pipeline_stages')
    .select('*')
    .eq('organization_id', ctx.orgId)
    .order('position')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

// PATCH — rename/recolor stages. Each stage's outreach_status is fixed — a
// 1:1 mapping to the funnel, unique per org (see FUNC-F8 in CLAUDE.md for why
// this replaced free add/delete/reorder) — so this only ever touches
// `name`/`color`. There is no POST/DELETE anymore: every org always has
// exactly one stage per OutreachStatus value, forever.
export async function PATCH(req: Request) {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stages } = await req.json() as { stages: Array<{ id: string; name: string; color: string }> }
  if (!Array.isArray(stages)) return NextResponse.json({ error: 'stages array required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify every id belongs to this org before touching anything.
  const ids = stages.map(s => s.id)
  const { data: owned, error: ownedErr } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', ctx.orgId)
    .in('id', ids)
  if (ownedErr) return NextResponse.json({ error: ownedErr.message }, { status: 400 })
  const ownedIds = new Set((owned ?? []).map(s => s.id as string))
  if (stages.some(s => !ownedIds.has(s.id))) {
    return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
  }

  for (const s of stages) {
    const { error } = await admin
      .from('pipeline_stages')
      .update({ name: s.name, color: s.color })
      .eq('id', s.id)
      .eq('organization_id', ctx.orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
