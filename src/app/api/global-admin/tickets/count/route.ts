import { NextResponse } from 'next/server'
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
    .select('role')
    .eq('id', user.id)
    .single()

  return (profile?.role === 'admin_global' || profile?.role === 'support') ? user : null
}

export async function GET() {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ count: 0 }, { status: 200 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { count, error } = await admin
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])

  if (error) return NextResponse.json({ count: 0 })
  return NextResponse.json({ count: count ?? 0 })
}
