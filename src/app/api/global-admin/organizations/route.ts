import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

export async function PATCH(req: Request) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const allowed = ['name', 'plan', 'max_seats', 'max_leads_per_month', 'billing_day', 'custom_price', 'vendor', 'is_active', 'internal_notes', 'logo_url', 'slug']
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

export async function GET() {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!orgs) return NextResponse.json([])

  // Enrich with admin_email and sdr_count
  const orgIds = orgs.map(o => o.id)

  const { data: admins } = await admin
    .from('users')
    .select('organization_id, email')
    .in('organization_id', orgIds)
    .eq('role', 'admin')
    .eq('is_active', true)

  const { data: sdrCounts } = await admin
    .from('users')
    .select('organization_id')
    .in('organization_id', orgIds)
    .eq('role', 'sdr')
    .eq('is_active', true)

  const adminMap = new Map<string, string>()
  admins?.forEach(u => { if (!adminMap.has(u.organization_id)) adminMap.set(u.organization_id, u.email) })

  const sdrCountMap = new Map<string, number>()
  sdrCounts?.forEach(u => sdrCountMap.set(u.organization_id, (sdrCountMap.get(u.organization_id) ?? 0) + 1))

  const enriched = orgs.map(o => ({
    ...o,
    admin_email: adminMap.get(o.id) ?? null,
    sdr_count: sdrCountMap.get(o.id) ?? 0,
  }))

  return NextResponse.json(enriched)
}
