import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

async function verifyAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// PATCH /api/prospects — reassign prospects (admin only)
// Mode A: { from_user_id, to_user_id } — transfer all leads between SDRs
// Mode B: { ids, assigned_to } — reassign specific prospects by ID
export async function PATCH(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Mode A: from_user_id → to_user_id (bulk transfer, optional limit)
  if (body.from_user_id && body.to_user_id) {
    const { from_user_id, to_user_id, limit } = body

    const { data: sdr } = await adminClient
      .from('users')
      .select('id, full_name, is_active, role')
      .eq('id', to_user_id)
      .single()

    if (!sdr || !sdr.is_active || sdr.role !== 'sdr') {
      return NextResponse.json({ error: 'Invalid or inactive SDR' }, { status: 400 })
    }

    let idsToMove: string[]

    if (limit && Number(limit) > 0) {
      // Pick the oldest N prospects (FIFO)
      const { data: picked } = await adminClient
        .from('prospects')
        .select('id')
        .eq('assigned_to', from_user_id)
        .order('created_at', { ascending: true })
        .limit(Number(limit))
      idsToMove = (picked ?? []).map((p: { id: string }) => p.id)
    } else {
      const { data: all } = await adminClient
        .from('prospects')
        .select('id')
        .eq('assigned_to', from_user_id)
      idsToMove = (all ?? []).map((p: { id: string }) => p.id)
    }

    if (idsToMove.length === 0) {
      return NextResponse.json({ ok: true, reassigned: 0, sdr_name: sdr.full_name })
    }

    const { error } = await adminClient
      .from('prospects')
      .update({ assigned_to: to_user_id, updated_at: new Date().toISOString() })
      .in('id', idsToMove)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true, reassigned: idsToMove.length, sdr_name: sdr.full_name })
  }

  // Mode B: specific IDs
  const { ids, assigned_to } = body
  if (!Array.isArray(ids) || ids.length === 0 || !assigned_to) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const { data: sdr } = await adminClient
    .from('users')
    .select('id, full_name, is_active, role, area_id')
    .eq('id', assigned_to)
    .single()

  if (!sdr || !sdr.is_active || sdr.role !== 'sdr') {
    return NextResponse.json({ error: 'Invalid or inactive SDR' }, { status: 400 })
  }

  const { error } = await adminClient
    .from('prospects')
    .update({ assigned_to, updated_at: new Date().toISOString() })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, reassigned: ids.length, sdr_name: sdr.full_name })
}

// DELETE /api/prospects — bulk delete by ids (admin only)
export async function DELETE(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Missing ids array' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Clear FK references in audit_log before deleting
  await adminClient.from('audit_log').update({ prospect_id: null }).in('prospect_id', ids)

  const { error } = await adminClient.from('prospects').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, deleted: ids.length })
}
