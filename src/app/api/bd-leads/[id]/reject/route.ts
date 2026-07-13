import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.organization_id || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: leadId } = await params
  const admin = adminClient()

  const { data: lead } = await admin
    .from('scraper_leads')
    .select('id, organization_id, lead_type, exported_to_crm')
    .eq('id', leadId)
    .single()

  if (!lead || lead.organization_id !== userData.organization_id) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  if (lead.lead_type !== 'bd_channel_contact') {
    return NextResponse.json({ error: 'Not a BD channel contact lead' }, { status: 400 })
  }
  if (lead.exported_to_crm) {
    return NextResponse.json({ error: 'This lead has already been confirmed' }, { status: 400 })
  }

  const { error } = await admin
    .from('scraper_leads')
    .update({ verification_status: 'rejected' })
    .eq('id', leadId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
