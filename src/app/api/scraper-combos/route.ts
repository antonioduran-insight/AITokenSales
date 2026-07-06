import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const [masterRes, orgRes] = await Promise.all([
    supabase.from('scraper_combos_master').select('*').eq('is_active', true).order('position'),
    supabase.from('org_combos').select('combo_code, is_active').eq('organization_id', userData?.organization_id),
  ])

  const orgMap = Object.fromEntries(
    (orgRes.data ?? []).map(c => [c.combo_code, c.is_active])
  )

  const result = (masterRes.data ?? []).map(combo => ({
    ...combo,
    org_active: orgMap[combo.code] ?? false,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!['admin', 'admin_global'].includes(userData?.role ?? '')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { combo_code, is_active } = await req.json()
  if (!combo_code || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'combo_code and is_active required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('org_combos')
    .upsert(
      { organization_id: userData?.organization_id, combo_code, is_active },
      { onConflict: 'organization_id,combo_code' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
