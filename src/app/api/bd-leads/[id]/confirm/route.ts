import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const tempMap: Record<string, string> = { HOT: 'Hot', WARM: 'Warm', COLD: 'Cold' }

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

  const { data: lead, error: leadError } = await admin
    .from('scraper_leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (leadError || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (lead.organization_id !== userData.organization_id) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  if (lead.lead_type !== 'bd_channel_contact') {
    return NextResponse.json({ error: 'Not a BD channel contact lead' }, { status: 400 })
  }
  if (lead.exported_to_crm || lead.verification_status === 'rejected') {
    return NextResponse.json({ error: 'This lead has already been processed' }, { status: 400 })
  }
  if (!lead.company) {
    return NextResponse.json({ error: 'Lead has no company name to match against bd_channels' }, { status: 400 })
  }

  // 1. Find an existing bd_channels row for this org + company. If one
  // exists, use it as-is — including its existing owner_sdr_id, even if
  // this run belongs to a different SDR (see PR summary for the flagged
  // edge case this implies).
  const { data: existingChannel } = await admin
    .from('bd_channels')
    .select('*')
    .eq('organization_id', userData.organization_id)
    .ilike('company_name', lead.company)
    .maybeSingle()

  let channel = existingChannel

  if (!channel) {
    // 2. No channel yet — determine this run's owning SDR via
    // run_sdr_assignments (the mechanism the BD scraping phase used to
    // record run ownership), not lead.sdr_id.
    const { data: assignment } = await admin
      .from('run_sdr_assignments')
      .select('sdr_id')
      .eq('run_id', lead.run_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const ownerSdrId = assignment?.sdr_id ?? null
    if (!ownerSdrId) {
      return NextResponse.json({ error: 'No SDR owner found for this run — cannot confirm' }, { status: 400 })
    }

    const { data: newChannel, error: channelError } = await admin
      .from('bd_channels')
      .insert({
        organization_id: userData.organization_id,
        company_name: lead.company,
        channel_family: lead.channel_family ?? null,
        market: lead.market ?? null,
        owner_sdr_id: ownerSdrId,
        run_id: lead.run_id,
      })
      .select()
      .single()

    if (channelError || !newChannel) {
      return NextResponse.json({ error: channelError?.message ?? 'Failed to create bd_channels row' }, { status: 500 })
    }
    channel = newChannel
  }

  if (!channel.owner_sdr_id) {
    return NextResponse.json({ error: 'This channel has no owning SDR — cannot confirm' }, { status: 400 })
  }

  // area_id is NOT NULL on prospects; bd_channel_contact visibility is now
  // owner-scoped (not area-scoped) via RLS, so this value is only here to
  // satisfy the column constraint — pull the owning SDR's own area.
  const { data: ownerUser } = await admin
    .from('users')
    .select('area_id')
    .eq('id', channel.owner_sdr_id)
    .single()

  if (!ownerUser?.area_id) {
    return NextResponse.json({ error: 'Channel owner has no area assigned — cannot confirm' }, { status: 400 })
  }

  // 3. Insert the prospects row, mirroring /api/runs/[id]/assign's shape
  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .insert({
      name: lead.full_name,
      linkedin_url: lead.linkedin_url ?? null,
      email: lead.email ?? null,
      company: lead.company ?? null,
      title: lead.title ?? null,
      industry: lead.industry ?? null,
      company_size: lead.company_size ?? null,
      icp_score: lead.icp_score ?? null,
      lead_temperature: tempMap[lead.temperature?.toUpperCase() ?? ''] ?? 'Cold',
      search_combo: lead.search_combo ?? null,
      custom1: lead.custom1 ?? null,
      custom2: lead.custom2 ?? null,
      market: lead.market ?? null,
      source: 'scraper',
      outreach_status: 'new',
      area_id: ownerUser.area_id,
      assigned_to: channel.owner_sdr_id,
      flag_tomorrow: false,
      lead_type: 'bd_channel_contact',
      bd_channel_id: channel.id,
    })
    .select()
    .single()

  if (prospectError || !prospect) {
    return NextResponse.json({ error: prospectError?.message ?? 'Failed to create prospect' }, { status: 500 })
  }

  // 4. Mark the scraper_leads row as exported + confirmed
  await admin
    .from('scraper_leads')
    .update({ exported_to_crm: true, verification_status: 'confirmed' })
    .eq('id', leadId)

  return NextResponse.json({
    ok: true,
    bd_channel_id: channel.id,
    bd_channel_created: !existingChannel,
    prospect_id: prospect.id,
    owner_sdr_id: channel.owner_sdr_id,
  })
}
