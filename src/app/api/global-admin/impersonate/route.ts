import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

async function verifyGlobalAdmin() {
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
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin_global' ? { user, profile } : null
}

export async function POST(req: NextRequest) {
  const auth = await verifyGlobalAdmin()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id, org_name } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  // Log to audit_log
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    await admin.from('audit_log').insert({
      actor_id: auth.user.id,
      actor_name: auth.profile.full_name ?? auth.user.email ?? 'global-admin',
      event_type: 'prospect_created',
      prospect_id: null,
      prospect_name: null,
      metadata: { action: 'impersonate', org_id, org_name },
    })
  } catch {
    // Non-critical — continue even if logging fails
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('impersonate_org', JSON.stringify({ id: org_id, name: org_name }), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
  })
  return response
}

export async function DELETE(_req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('impersonate_org', '', {
    path: '/',
    maxAge: 0,
    httpOnly: false,
    sameSite: 'lax',
  })
  return response
}
