import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const SCRAPER_API = process.env.SCRAPER_API_URL ?? ''

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface SenderProfilePayload {
  id: string | null
  display_name: string
  title: string
  company: string
  style_hint: string | null
  icp_focus: string[]
  language: string
  years_experience: number | null
  seniority: string | null
  expertise_area: string | null
}

// Bulk-triggers message generation for already-confirmed BD channel
// contacts. Deliberately NOT called automatically from Confirm — this
// calls out to the external scraper backend and takes real time, so it's
// a separate, explicit, possibly-bulk action instead.
export async function POST(req: NextRequest) {
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

  const { lead_ids } = await req.json()
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ error: 'lead_ids is required' }, { status: 400 })
  }

  if (!SCRAPER_API) {
    return NextResponse.json({ error: 'Scraper backend is not configured' }, { status: 500 })
  }

  const admin = adminClient()

  const [{ data: leads, error: leadsError }, { data: org }, { data: channels }] = await Promise.all([
    admin
      .from('scraper_leads')
      .select('id, run_id, organization_id, lead_type, verification_status, custom1, company')
      .in('id', lead_ids),
    admin
      .from('organizations')
      .select('plan, anthropic_key, anthropic_base_url, anthropic_model')
      .eq('id', userData.organization_id)
      .single(),
    admin
      .from('bd_channels')
      .select('company_name, owner_sdr_id')
      .eq('organization_id', userData.organization_id),
  ])

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!org?.anthropic_key) {
    return NextResponse.json(
      { error: 'Anthropic key must be configured in Settings → Scraper before generating messages.' },
      { status: 400 }
    )
  }

  // Re-filter server-side: org-owned, confirmed BD contacts, no draft yet
  const eligible = (leads ?? []).filter(l =>
    l.organization_id === userData.organization_id &&
    l.lead_type === 'bd_channel_contact' &&
    l.verification_status === 'confirmed' &&
    !l.custom1 &&
    l.run_id
  )

  if (eligible.length === 0) {
    return NextResponse.json({ error: 'No eligible leads selected' }, { status: 400 })
  }

  // Owner resolution mirrors Confirm's own bd_channels lookup: match by
  // organization + company name. This is the current owner of the
  // resulting prospect, which can differ from the run's own SDR (see the
  // owner-conflict case in Confirm) — messages should be voiced as the
  // actual current owner, not whoever ran the scrape.
  const ownerByCompany: Record<string, string | null> = {}
  for (const c of channels ?? []) {
    ownerByCompany[c.company_name.trim().toLowerCase()] = c.owner_sdr_id
  }

  const skipped: { lead_id: string; reason: string }[] = []
  const groups: Record<string, { run_id: string; owner_sdr_id: string; lead_ids: string[] }> = {}

  for (const lead of eligible) {
    const ownerSdrId = lead.company ? ownerByCompany[lead.company.trim().toLowerCase()] : undefined
    if (!ownerSdrId) {
      skipped.push({ lead_id: lead.id, reason: "No bd_channels owner found for this lead's company" })
      continue
    }
    const key = `${lead.run_id}::${ownerSdrId}`
    groups[key] = groups[key] ?? { run_id: lead.run_id, owner_sdr_id: ownerSdrId, lead_ids: [] }
    groups[key].lead_ids.push(lead.id)
  }

  if (Object.keys(groups).length === 0) {
    return NextResponse.json({ error: 'No eligible leads could be matched to an owning SDR', skipped }, { status: 400 })
  }

  // Sender profile + SDR context per distinct owner — same lookup
  // /api/runs already does for individual-lead runs (sender_profiles
  // scoped to the owner, is_default + is_active, plus years_experience/
  // seniority/expertise_area from users).
  const ownerIds = [...new Set(Object.values(groups).map(g => g.owner_sdr_id))]
  const profileByOwner: Record<string, SenderProfilePayload | null> = {}
  const profileIdByOwner: Record<string, string | null> = {}

  await Promise.all(ownerIds.map(async sdrId => {
    const [{ data: profile }, { data: sdrCtx }] = await Promise.all([
      admin
        .from('sender_profiles')
        .select('id, display_name, title, company, style_hint, icp_focus, language')
        .eq('user_id', sdrId)
        .eq('organization_id', userData.organization_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle(),
      admin
        .from('users')
        .select('years_experience, seniority, expertise_area')
        .eq('id', sdrId)
        .single(),
    ])

    profileIdByOwner[sdrId] = profile?.id ?? null
    profileByOwner[sdrId] = profile ? {
      id: profile.id,
      display_name: profile.display_name,
      title: profile.title,
      company: profile.company,
      style_hint: profile.style_hint ?? null,
      icp_focus: profile.icp_focus ?? [],
      language: profile.language ?? 'en',
      years_experience: sdrCtx?.years_experience ?? null,
      seniority: sdrCtx?.seniority ?? null,
      expertise_area: sdrCtx?.expertise_area ?? null,
    } : null
  }))

  // The backend endpoint is scoped per run_id; a run's confirmed leads can
  // have more than one current owner (owner-conflict case), so we call it
  // once per distinct (run_id, owner_sdr_id) pair rather than once per run.
  const results: { run_id: string; owner_sdr_id: string; ok: boolean; error?: string }[] = []
  for (const group of Object.values(groups)) {
    try {
      const res = await fetch(`${SCRAPER_API}/bd-runs/${group.run_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: userData.organization_id,
          lead_ids: group.lead_ids,
          plan: org.plan,
          sender_profile_id: profileIdByOwner[group.owner_sdr_id],
          sender_profile: profileByOwner[group.owner_sdr_id],
          anthropic_key: org.anthropic_key,
          anthropic_base_url: org.anthropic_base_url ?? 'https://api.aitokenking.com.tw/api/v1',
          anthropic_model: org.anthropic_model ?? 'claude-sonnet-4.6',
        }),
      })
      if (!res.ok) {
        results.push({ run_id: group.run_id, owner_sdr_id: group.owner_sdr_id, ok: false, error: await res.text() })
      } else {
        results.push({ run_id: group.run_id, owner_sdr_id: group.owner_sdr_id, ok: true })
      }
    } catch (e) {
      results.push({ run_id: group.run_id, owner_sdr_id: group.owner_sdr_id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ results, skipped })
}
