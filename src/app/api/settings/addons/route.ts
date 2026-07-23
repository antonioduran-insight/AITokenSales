import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Lightweight list of the caller org's active add-on types. Used by the sidebar
// to decide which add-on-gated sections (e.g. Bridge) to show.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ addons: [] })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!userData?.organization_id) return NextResponse.json({ addons: [] })

  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_addons')
    .select('addon_type')
    .eq('organization_id', userData.organization_id)
    .eq('is_active', true)

  return NextResponse.json({ addons: (data ?? []).map(a => a.addon_type) })
}
