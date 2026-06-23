import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Verify the requesting user is an admin
async function verifyAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin' ? user : null
}

// POST /api/users — create a new SDR
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { full_name, email, password, area_id } = body

  if (!full_name || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'Failed to create user' }, { status: 400 })
  }

  // Insert into public.users
  const { error: profileError } = await adminClient.from('users').insert({
    id: authData.user.id,
    full_name,
    email,
    role: 'sdr',
    area_id: area_id || null,
    is_active: true,
  })

  if (profileError) {
    // Cleanup orphaned auth user
    await adminClient.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ id: authData.user.id })
}

// DELETE /api/users — permanently delete an SDR
export async function DELETE(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check they're not an admin
  const { data: profile } = await adminClient.from('users').select('role').eq('id', id).single()
  if (profile?.role === 'admin') {
    return NextResponse.json({ error: 'Cannot delete admin users' }, { status: 403 })
  }

  // Clear all FK references to this user in prospects
  await adminClient.from('prospects').update({ assigned_to: null }).eq('assigned_to', id)
  await adminClient.from('prospects').update({ created_by: null }).eq('created_by', id)

  // Delete from public.users first (removes FK back to auth.users)
  const { error: profileDeleteError } = await adminClient.from('users').delete().eq('id', id)
  if (profileDeleteError) return NextResponse.json({ error: profileDeleteError.message }, { status: 400 })

  // Delete from Supabase Auth
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(id)
  if (authDeleteError) return NextResponse.json({ error: authDeleteError.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

// PATCH /api/users — toggle active status OR unassign all leads
export async function PATCH(req: NextRequest) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, is_active, action } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Unassign all leads from this SDR
  if (action === 'unassign') {
    // Count first, then update
    const { count } = await adminClient
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', id)
    const { error } = await adminClient
      .from('prospects')
      .update({ assigned_to: null })
      .eq('assigned_to', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, count: count ?? 0 })
  }

  // Toggle active status
  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'Missing is_active or action' }, { status: 400 })
  }

  const { error } = await adminClient.from('users').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
