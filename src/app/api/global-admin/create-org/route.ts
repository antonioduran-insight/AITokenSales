import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { normalizeAnthropicBaseUrl } from '@/lib/utils/anthropic'
import { isAddonSellable, isAddonIncluded } from '@/lib/types'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

const MARKET_MAP: Record<string, { continent: string; country: string | null; language: string }> = {
  Taiwan: { continent: 'Asia', country: 'Taiwan', language: 'zh' },
  LATAM: { continent: 'Americas', country: null, language: 'es' },
  Vietnam: { continent: 'Asia', country: 'Vietnam', language: 'vi' },
  Europe: { continent: 'Europe', country: null, language: 'en' },
  Global: { continent: 'Global', country: null, language: 'en' },
}

export async function POST(req: NextRequest) {
  const user = await requireGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    name, slug, plan, logo_url, admin_name, admin_email, admin_password,
    max_seats, max_leads_per_month, custom_price, vendor,
    markets, internal_notes, addons,
    apify_token, anthropic_key, anthropic_base_url, anthropic_model,
  } = body

  if (!name || !slug || !plan || !admin_name || !admin_email || !admin_password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Insert organization
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name,
      slug,
      plan,
      logo_url: logo_url ?? null,
      max_seats: max_seats ?? 3,
      max_leads_per_month: max_leads_per_month ?? null,
      custom_price: custom_price ?? null,
      vendor: vendor ?? null,
      internal_notes: internal_notes ?? null,
      apify_token: apify_token ?? null,
      anthropic_key: anthropic_key ?? null,
      anthropic_base_url: normalizeAnthropicBaseUrl(anthropic_base_url),
      anthropic_model: anthropic_model || null,
      is_active: true,
      billing_day: 10,
    })
    .select()
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message ?? 'Failed to create org' }, { status: 400 })
  }

  // 2. Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: admin_email,
    password: admin_password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    await admin.from('organizations').delete().eq('id', org.id)
    return NextResponse.json({ error: authError?.message ?? 'Failed to create auth user' }, { status: 400 })
  }

  // 3. Insert into users table
  const { error: userError } = await admin.from('users').insert({
    id: authData.user.id,
    full_name: admin_name,
    email: admin_email,
    role: 'admin',
    organization_id: org.id,
    is_active: true,
  })

  if (userError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    await admin.from('organizations').delete().eq('id', org.id)
    return NextResponse.json({ error: userError.message }, { status: 400 })
  }

  // 4. Insert addons if selected
  //
  // Filtered by plan eligibility, not trusted from the form. The org's plan
  // was just written above, so the rule is applied against what was actually
  // saved rather than what the client claimed. Ineligible entries are dropped
  // silently on purpose: the UI already prevents selecting them, so anything
  // arriving here is either a stale tab or a hand-crafted request, and
  // failing the whole org creation over it would be a worse outcome than
  // creating the org without an add-on that could never have been sold.
  const eligibleAddons = Array.isArray(addons)
    ? (addons as string[]).filter(
        a => isAddonSellable(a, org.plan) && !isAddonIncluded(a, org.plan)
      )
    : []

  if (eligibleAddons.length > 0) {
    const addonRows = eligibleAddons.map((addonType: string) => ({
      organization_id: org.id,
      addon_type: addonType,
      is_active: true,
      price_monthly: null,
      activated_at: new Date().toISOString(),
    }))
    const { error: addonsError } = await admin.from('organization_addons').insert(addonRows)
    if (addonsError) {
      await admin.auth.admin.deleteUser(authData.user.id)
      await admin.from('organizations').delete().eq('id', org.id)
      return NextResponse.json({ error: `Failed to set addons: ${addonsError.message}` }, { status: 400 })
    }
  }

  // 6. Seed the GLOBAL catalogue's active combos for this org.
  //
  // `.is('organization_id', null)` is load-bearing since
  // 20260904_org_owned_combos.sql: `scraper_combos_master` now also holds
  // combos that belong to a single customer, and this runs with the admin
  // client, which bypasses the RLS that would otherwise hide them. Without the
  // filter, every new org would be seeded with every other customer's private
  // search strategies — visible to them in Settings, and billed for on every
  // run that used them.
  const { data: masterCombos } = await admin
    .from('scraper_combos_master')
    .select('code')
    .eq('is_active', true)
    .is('organization_id', null)
  if (masterCombos && masterCombos.length > 0) {
    await admin.from('org_combos').insert(
      masterCombos.map((c: { code: string }) => ({
        organization_id: org.id,
        combo_code: c.code,
        is_active: true,
      }))
    )
  }

  return NextResponse.json({ ok: true, org_id: org.id })
}
