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
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin_global' ? user : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: org, error } = await admin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !org) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })

  // Enrich
  const [adminsRes, sdrsRes, addonsRes, ticketsRes] = await Promise.all([
    admin.from('users').select('email').eq('organization_id', id).eq('role', 'admin').eq('is_active', true).limit(1).single(),
    admin.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', id).eq('role', 'sdr').eq('is_active', true),
    admin.from('organization_addons').select('*').eq('organization_id', id).eq('is_active', true),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('organization_id', id).in('status', ['open', 'in_progress']),
  ])

  // leads this month — use monthly_lead_counts (prospects has no organization_id column)
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const { data: leadCountRow } = await admin
    .from('monthly_lead_counts')
    .select('count')
    .eq('organization_id', id)
    .eq('year_month', yearMonth)
    .single()
  const leadsThisMonth = leadCountRow?.count ?? 0

  return NextResponse.json({
    ...org,
    admin_email: adminsRes.data?.email ?? null,
    sdr_count: sdrsRes.count ?? 0,
    addons: addonsRes.data ?? [],
    open_tickets_count: ticketsRes.count ?? 0,
    leads_this_month: leadsThisMonth,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const fields = await req.json()

  const allowed = ['name', 'slug', 'plan', 'max_seats', 'max_leads_per_month', 'billing_day', 'custom_price', 'vendor', 'is_active', 'internal_notes', 'logo_url', 'default_language']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in fields) patch[key] = fields[key]
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('organizations')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
