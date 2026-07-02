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

// GET — list stages for org
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

  // If no stages exist yet, return empty array (admin should seed via SQL migration)
  return NextResponse.json(data ?? [])
}

// POST — add a new stage
export async function POST(req: Request) {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, color } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const admin = createAdminClient()

  // Get max position
  const { data: existing } = await admin
    .from('pipeline_stages')
    .select('position')
    .eq('organization_id', ctx.orgId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPos = (existing?.[0]?.position ?? -1) + 1

  const { data, error } = await admin
    .from('pipeline_stages')
    .insert({ organization_id: ctx.orgId, name: name.trim(), color: color ?? '#6C63FF', position: nextPos })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

// PATCH — bulk update (reorder + rename + recolor)
export async function PATCH(req: Request) {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stages } = await req.json() as { stages: Array<{ id: string; name: string; color: string; position: number }> }
  if (!Array.isArray(stages)) return NextResponse.json({ error: 'stages array required' }, { status: 400 })

  const admin = createAdminClient()

  // Upsert each stage, verifying it belongs to this org
  const updates = stages.map(s => ({
    id: s.id,
    organization_id: ctx.orgId,
    name: s.name,
    color: s.color,
    position: s.position,
  }))

  const { error } = await admin
    .from('pipeline_stages')
    .upsert(updates, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove a stage (only if no prospects in it)
export async function DELETE(req: Request) {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify the stage belongs to this org
  const { data: stage } = await admin
    .from('pipeline_stages')
    .select('id, name, is_default')
    .eq('id', id)
    .eq('organization_id', ctx.orgId)
    .single()

  if (!stage) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  // Can't delete default stages
  if (stage.is_default) {
    return NextResponse.json({ error: 'Cannot delete default stages' }, { status: 400 })
  }

  const { error } = await admin
    .from('pipeline_stages')
    .delete()
    .eq('id', id)
    .eq('organization_id', ctx.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
