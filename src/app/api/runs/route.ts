import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getLeadQuota } from '@/lib/utils/lead-quota'

const SCRAPER_API = process.env.SCRAPER_API_URL ?? ''

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    // Only org admins can run the scraper. SDRs have no scraper access at all.
    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Only the organization admin can run the scraper' }, { status: 403 })
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('plan, max_leads_per_month, billing_day, apify_token, anthropic_key, anthropic_base_url, anthropic_model')
      .eq('id', userData?.organization_id)
      .single()

    if (!org?.apify_token || !org?.anthropic_key) {
      return NextResponse.json(
        { error: 'Apify token and Anthropic key must be configured in Settings → Scraper before running.' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { combos, market, markets, total_leads } = body
    // One SDR per run. `sdr_ids` is still accepted (first element wins) so an
    // older client can't silently send a multi-SDR payload.
    const sdrId: string | null = body.sdr_id ?? body.sdr_ids?.[0] ?? null

    if (!combos?.length || !total_leads) {
      return NextResponse.json({ error: 'combos and total_leads are required' }, { status: 400 })
    }
    if (!sdrId) {
      return NextResponse.json({ error: 'sdr_id is required — pick the SDR this run is for' }, { status: 400 })
    }
    const primaryMarket: string = markets?.[0] ?? market ?? 'global'
    const allMarkets: string[] = markets?.length ? markets : (market ? [market] : [])

    // Lead limit check — scoped to the current billing period (renews on the
    // org's billing_day, not the calendar month).
    const quotaClient = adminClient()
    const quota = await getLeadQuota(
      quotaClient,
      userData.organization_id,
      org.billing_day ?? 1,
      org.max_leads_per_month ?? null
    )

    if (!quota.unlimited && total_leads > quota.available) {
      return NextResponse.json(
        { error: `Lead limit reached for this billing period. Used: ${quota.used}, Limit: ${quota.max}, Available: ${quota.available}, Requested: ${total_leads}` },
        { status: 429 }
      )
    }

    // Build the single SDR assignment for this run. The chosen SDR is ALWAYS
    // honoured (no plan-based fallback to the admin) — the leads and the
    // personalised messages both belong to them.
    interface BuiltAssignment {
      sdr_id: string
      sender_profile_id: string | null
      sender_profile: {
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
      } | null
    }

    const [{ data: profile }, { data: sdrCtx }] = await Promise.all([
      supabase
        .from('sender_profiles')
        .select('id, display_name, title, company, style_hint, icp_focus, language')
        .eq('user_id', sdrId)
        .eq('organization_id', userData.organization_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('users')
        .select('years_experience, seniority, expertise_area')
        .eq('id', sdrId)
        .maybeSingle(),
    ])

    const sdrAssignments: BuiltAssignment[] = [{
      sdr_id: sdrId,
      sender_profile_id: profile?.id ?? null,
      sender_profile: profile ? {
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
      } : null,
    }]

    const admin = adminClient()

    // Create run record in Supabase
    const { data: run, error: runError } = await admin
      .from('runs')
      .insert({
        organization_id: userData.organization_id,
        executed_by: user.id,
        combos,
        market: primaryMarket,
        markets: allMarkets,
        total_leads_requested: total_leads,
        sdr_count: sdrAssignments.length,
        plan: org.plan,
        status: 'pending',
      })
      .select()
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: runError?.message ?? 'Failed to create run' }, { status: 500 })
    }

    // Single SDR assignment record for this run
    await admin.from('run_sdr_assignments').insert({
      run_id: run.id,
      sdr_id: sdrId,
      sender_profile_id: sdrAssignments[0].sender_profile_id,
      assigned_markets: allMarkets,
    })

    // Call Railway scraper backend
    if (SCRAPER_API) {
      const scraperPayload = {
        run_id: run.id,
        organization_id: userData.organization_id,
        plan: org.plan,
        markets: allMarkets,
        combos: combos as string[],
        total_leads: Number(total_leads),
        sdr_assignments: sdrAssignments.map(a => ({
          sdr_id: a.sdr_id,
          sender_profile_id: a.sender_profile_id ?? null,
          sender_profile: a.sender_profile ?? null,
          assigned_markets: allMarkets,
        })),
        apify_token: org.apify_token,
        anthropic_key: org.anthropic_key,
        anthropic_base_url: org.anthropic_base_url ?? 'https://api.aitokenking.com.tw/api/v1',
        anthropic_model: org.anthropic_model ?? 'claude-sonnet-4.6',
      }

      console.log('Sending to scraper:', JSON.stringify(scraperPayload, null, 2))

      const scraperRes = await fetch(`${SCRAPER_API}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scraperPayload),
      })

      const scraperText = await scraperRes.text()
      console.log('Scraper response:', scraperRes.status, scraperText)

      if (!scraperRes.ok) {
        await admin.from('runs').update({ status: 'failed', error_message: scraperText }).eq('id', run.id)
        return NextResponse.json({ error: `Scraper backend error: ${scraperText}` }, { status: 502 })
      }
    }

    return NextResponse.json({ run_id: run.id, status: 'started' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE() {
  try {
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

    const admin = adminClient()
    const { error } = await admin
      .from('runs')
      .delete()
      .eq('organization_id', userData.organization_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

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

    const { data, error } = await supabase
      .from('runs')
      .select('*, executor:users!executed_by(full_name), run_sdr_assignments(sdr_id, leads_assigned, sender_profile_id, user:users(full_name))')
      .eq('organization_id', userData?.organization_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data ?? [])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
