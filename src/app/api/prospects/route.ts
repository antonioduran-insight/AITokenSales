import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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
//
// The admin-role check and the target-SDR validation are independent reads
// (neither needs the other's result), so they run in parallel via
// Promise.all instead of sequentially — this was measured at ~4.9s before
// (F17), and 3 of those 4 round trips were serialized for no reason.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const admin = adminClient()

  const targetSdrId: string | undefined = body.to_user_id ?? body.assigned_to
  if (!targetSdrId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const [caller, sdrResult] = await Promise.all([
    verifyAdmin(),
    admin.from('users').select('id, full_name, is_active, role').eq('id', targetSdrId).single(),
  ])

  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sdr = sdrResult.data
  if (!sdr || !sdr.is_active || sdr.role !== 'sdr') {
    return NextResponse.json({ error: 'Invalid or inactive SDR' }, { status: 400 })
  }

  // Mode A: from_user_id → to_user_id (bulk transfer, optional limit)
  if (body.from_user_id && body.to_user_id) {
    const { from_user_id, limit } = body

    let idsToMove: string[]
    if (limit && Number(limit) > 0) {
      // Pick the oldest N prospects (FIFO)
      const { data: picked } = await admin
        .from('prospects')
        .select('id')
        .eq('assigned_to', from_user_id)
        .order('created_at', { ascending: true })
        .limit(Number(limit))
      idsToMove = (picked ?? []).map((p: { id: string }) => p.id)
    } else {
      const { data: all } = await admin
        .from('prospects')
        .select('id')
        .eq('assigned_to', from_user_id)
      idsToMove = (all ?? []).map((p: { id: string }) => p.id)
    }

    if (idsToMove.length === 0) {
      return NextResponse.json({ ok: true, reassigned: 0, sdr_name: sdr.full_name })
    }

    const { error } = await admin
      .from('prospects')
      .update({ assigned_to: body.to_user_id, updated_at: new Date().toISOString() })
      .in('id', idsToMove)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true, reassigned: idsToMove.length, sdr_name: sdr.full_name })
  }

  // Mode B: specific IDs
  const { ids } = body
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const { error } = await admin
    .from('prospects')
    .update({ assigned_to: targetSdrId, updated_at: new Date().toISOString() })
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

  const db = adminClient()

  // Clear FK references in audit_log before deleting
  await db.from('audit_log').update({ prospect_id: null }).in('prospect_id', ids)

  const { error } = await db.from('prospects').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, deleted: ids.length })
}
