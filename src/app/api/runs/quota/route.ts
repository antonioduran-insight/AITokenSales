import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getLeadQuota } from '@/lib/utils/lead-quota'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Lead quota for the caller's org, scoped to the CURRENT billing period
// (renews on the org's billing_day, not the calendar month).
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userData?.organization_id) {
      return NextResponse.json({ error: 'No organization' }, { status: 400 })
    }

    const admin = adminClient()
    const { data: org } = await admin
      .from('organizations')
      .select('max_leads_per_month, billing_day')
      .eq('id', userData.organization_id)
      .single()

    const quota = await getLeadQuota(
      admin,
      userData.organization_id,
      org?.billing_day ?? 1,
      org?.max_leads_per_month ?? null
    )

    return NextResponse.json(quota)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
