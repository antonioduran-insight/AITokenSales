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

  return profile?.role === 'admin_global' ? user : null
}

export async function GET() {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Fetch active SDR counts per org
  const orgIds = (data ?? []).map((o: { id: string }) => o.id)
  const { data: sdrRows } = orgIds.length > 0
    ? await admin.from('users').select('organization_id').in('organization_id', orgIds).eq('role', 'sdr').eq('is_active', true)
    : { data: [] }

  const sdrCountMap: Record<string, number> = {}
  sdrRows?.forEach((u: { organization_id: string }) => {
    sdrCountMap[u.organization_id] = (sdrCountMap[u.organization_id] ?? 0) + 1
  })

  const enriched = (data ?? []).map((o: { id: string }) => ({ ...o, sdr_count: sdrCountMap[o.id] ?? 0 }))
  return NextResponse.json(enriched)
}
