import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { orgHasActiveAddon } from '@/lib/utils/addons'

const SCRAPER_API = process.env.SCRAPER_API_URL ?? ''
const MIN_LEADS = 10

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

    if (!userData?.organization_id || userData.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!(await orgHasActiveAddon(userData.organization_id, 'bd_group'))) {
      return NextResponse.json({ error: 'BD Group add-on is not active for this organization' }, { status: 403 })
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('plan, apify_token')
      .eq('id', userData.organization_id)
      .single()

    // Unlike individual runs, BD runs don't need the Anthropic fields here —
    // message generation is a separate later step (POST /bd-runs/{run_id}/messages).
    if (!org?.apify_token) {
      return NextResponse.json(
        { error: 'Apify token must be configured in Settings → Scraper before running.' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { seed_list_ids, owner_sdr_id, total_leads } = body

    if (!Array.isArray(seed_list_ids) || seed_list_ids.length === 0) {
      return NextResponse.json({ error: 'seed_list_ids is required' }, { status: 400 })
    }
    if (!owner_sdr_id) {
      return NextResponse.json({ error: 'owner_sdr_id is required' }, { status: 400 })
    }
    if (!total_leads || total_leads < MIN_LEADS) {
      return NextResponse.json({ error: `total_leads must be at least ${MIN_LEADS}` }, { status: 400 })
    }

    const admin = adminClient()

    // Validate the seed lists belong to this org
    const { data: seedLists } = await admin
      .from('org_company_seed_lists')
      .select('*')
      .eq('organization_id', userData.organization_id)
      .in('id', seed_list_ids)

    if (!seedLists || seedLists.length !== seed_list_ids.length) {
      return NextResponse.json({ error: 'One or more seed lists were not found in this organization' }, { status: 400 })
    }

    // Validate the owner is an active SDR with scraper access in this org
    const { data: owner } = await admin
      .from('users')
      .select('id, organization_id, role, scraper_access, is_active, full_name')
      .eq('id', owner_sdr_id)
      .single()

    if (!owner || owner.organization_id !== userData.organization_id || owner.role !== 'sdr' || !owner.is_active) {
      return NextResponse.json({ error: 'owner_sdr_id must be an active SDR in this organization' }, { status: 400 })
    }
    if (!owner.scraper_access) {
      return NextResponse.json({ error: 'This SDR does not have scraper access enabled' }, { status: 400 })
    }

    // Create the pending run row — same pattern as the individual-lead flow
    const { data: run, error: runError } = await admin
      .from('runs')
      .insert({
        organization_id: userData.organization_id,
        executed_by: user.id,
        run_type: 'bd',
        total_leads_requested: total_leads,
        sdr_count: 1,
        plan: org.plan,
        status: 'pending',
      })
      .select()
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: runError?.message ?? 'Failed to create run' }, { status: 500 })
    }

    // Record which seed lists this run covers
    await admin.from('run_seed_lists').insert(
      seedLists.map(sl => ({ run_id: run.id, seed_list_id: sl.id }))
    )

    // Record the single owning SDR — the same run_sdr_assignments mechanism
    // the BD Leads confirm/messages routes already rely on to resolve
    // run ownership
    const assignedMarkets = [...new Set(seedLists.map(sl => sl.market).filter((m): m is string => !!m))]
    await admin.from('run_sdr_assignments').insert({
      run_id: run.id,
      sdr_id: owner_sdr_id,
      leads_assigned: total_leads,
      assigned_markets: assignedMarkets,
    })

    // Call the external scraper backend
    if (SCRAPER_API) {
      const scraperPayload = {
        run_id: run.id,
        organization_id: userData.organization_id,
        plan: org.plan,
        seed_lists: seedLists.map(sl => ({
          id: sl.id,
          list_name: sl.list_name,
          company_names: sl.company_names,
          market: sl.market,
          title_keywords: sl.title_keywords,
          seniority_levels: sl.seniority_levels,
          channel_family: sl.channel_family,
        })),
        total_leads: Number(total_leads),
        owner_sdr_id,
        apify_token: org.apify_token,
      }

      const scraperRes = await fetch(`${SCRAPER_API}/bd-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scraperPayload),
      })

      if (!scraperRes.ok) {
        const scraperText = await scraperRes.text()
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
