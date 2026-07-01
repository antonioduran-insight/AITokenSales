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

// PATCH /api/prospects — reassign one or more prospects to an SDR (admin only)
// Body: { ids: string[], assigned_to: string }
export async function PATCH(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, assigned_to } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0 || !assigned_to) {
    return NextResponse.json({ error: 'Missing ids or assigned_to' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Validate target SDR: must be active SDR
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
