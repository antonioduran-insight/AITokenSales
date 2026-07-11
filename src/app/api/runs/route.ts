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

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, role, scraper_access')
      .eq('id', user.id)
      .single()

    if (!userData?.scraper_access && userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Scraper access not enabled for this user' }, { status: 403 })
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('plan, max_leads_per_month, apify_token, anthropic_key, anthropic_base_url, anthropic_model')
      .eq('id', userData?.organization_id)
      .single()

    if (!org?.apify_token || !org?.anthropic_key) {
      return NextResponse.json(
        { error: 'Apify token and Anthropic key must be configured in Settings → Scraper before running.' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { combos, market, markets, total_leads, sdr_ids, sdr_market_assignments } = body

    if (!combos?.length || !total_leads) {
      return NextResponse.json({ error: 'combos and total_leads are required' }, { status: 400 })
    }
    const primaryMarket: string = markets?.[0] ?? market ?? 'global'
    const allMarkets: string[] = markets?.length ? markets : (market ? [market] : [])

    // Monthly lead limit check
    const currentMonth = new Date().toISOString().slice(0, 7)
    const { data: monthlyCount } = await supabase
      .from('monthly_lead_counts')
      .select('count')
      .eq('organization_id', userData.organization_id)
      .eq('year_month', currentMonth)
      .single()

    const usedLeads = monthlyCount?.count ?? 0
    const maxLeads = org.max_leads_per_month ?? 1000

    if (maxLeads < 999999 && usedLeads + total_leads > maxLeads) {
      return NextResponse.json(
        { error: `Monthly lead limit exceeded. Used: ${usedLeads}, Limit: ${maxLeads}, Requested: ${total_leads}` },
        { status: 429 }
      )
    }

    // Build SDR assignments
    const isBasic = org.plan === 'basic'

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

    let sdrAssignments: BuiltAssignment[] = []

    if (sdr_ids?.length > 0 && !isBasic) {
      for (const sdrId of sdr_ids as string[]) {
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
            .single(),
        ])

        sdrAssignments.push({
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
        })
      }
    } else {
      const { data: selfCtx } = await supabase
        .from('users')
        .select('years_experience, seniority, expertise_area')
        .eq('id', user.id)
        .single()
      sdrAssignments = [{
        sdr_id: user.id,
        sender_profile_id: null,
        sender_profile: null,
      }]
      // attach context to a dummy profile shape if we have it
      if (selfCtx) {
        sdrAssignments[0].sender_profile = {
          id: null,
          display_name: '',
          title: '',
          company: '',
          style_hint: null,
          icp_focus: [],
          language: 'en',
          years_experience: selfCtx.years_experience ?? null,
          seniority: selfCtx.seniority ?? null,
          expertise_area: selfCtx.expertise_area ?? null,
        }
      }
    }

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

    // Create SDR assignment records
    if (sdrAssignments.length > 0) {
      await admin.from('run_sdr_assignments').insert(
        sdrAssignments.map(a => ({
          run_id: run.id,
          sdr_id: a.sdr_id,
          sender_profile_id: a.sender_profile_id,
          assigned_markets: sdr_market_assignments?.[a.sdr_id]?.length
            ? sdr_market_assignments[a.sdr_id]
            : allMarkets,
        }))
      )
    }

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
          assigned_markets: sdr_market_assignments?.[a.sdr_id]?.length
            ? sdr_market_assignments[a.sdr_id]
            : allMarkets,
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
