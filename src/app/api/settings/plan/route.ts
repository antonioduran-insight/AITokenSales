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

export async function GET() {
  const ctx = await getOrgAdmin()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Org data
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, plan, max_seats, max_leads_per_month, billing_day, custom_price')
    .eq('id', ctx.orgId)
    .single()

  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  // Active SDR count
  const { count: sdrCount } = await admin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ctx.orgId)
    .eq('role', 'sdr')
    .eq('is_active', true)

  // Active SDR list (for display)
  const { data: sdrs } = await admin
    .from('users')
    .select('id, full_name, email, created_at')
    .eq('organization_id', ctx.orgId)
    .eq('role', 'sdr')
    .eq('is_active', true)
    .order('full_name')

  // Leads count for current billing period
  const now = new Date()
  const billingDay = org.billing_day ?? 1
  let periodStart = new Date(now.getFullYear(), now.getMonth(), billingDay)
  if (periodStart > now) {
    periodStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay)
  }

  const { count: leadsCount } = await admin
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ctx.orgId)
    .gte('created_at', periodStart.toISOString())

  // Active add-ons
  const { data: addons } = await admin
    .from('organization_addons')
    .select('*')
    .eq('organization_id', ctx.orgId)
    .eq('is_active', true)

  return NextResponse.json({
    org,
    sdrCount: sdrCount ?? 0,
    sdrs: sdrs ?? [],
    leadsCount: leadsCount ?? 0,
    periodStart: periodStart.toISOString(),
    addons: addons ?? [],
  })
}
