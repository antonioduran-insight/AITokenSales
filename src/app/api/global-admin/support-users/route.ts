import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

// GET — list Support staff accounts
export async function GET() {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('users')
    .select('id, full_name, email, is_active, created_at')
    .eq('role', 'support')
    .order('full_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

// POST — create a Support staff account. Org-independent by design
// (organization_id: null), same as admin_global — Support isn't tied to
// any client.
export async function POST(req: NextRequest) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { full_name, email, password } = await req.json()
  if (!full_name?.trim() || !email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'Failed to create user' }, { status: 400 })
  }

  const { error: profileError } = await admin.from('users').insert({
    id: authData.user.id,
    full_name: full_name.trim(),
    email: email.trim(),
    role: 'support',
    organization_id: null,
    is_active: true,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ id: authData.user.id }, { status: 201 })
}

// PATCH — activate/deactivate a Support staff account
export async function PATCH(req: NextRequest) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, is_active } = await req.json()
  if (!id || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'Missing id or is_active' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await admin
    .from('users')
    .update({ is_active })
    .eq('id', id)
    .eq('role', 'support')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
