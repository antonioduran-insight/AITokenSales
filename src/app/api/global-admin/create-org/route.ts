import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

async function verifyGlobalAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'admin_global' ? user : null
}

const MARKET_MAP: Record<string, { continent: string; country: string | null; language: string }> = {
  Taiwan: { continent: 'Asia', country: 'Taiwan', language: 'zh' },
  LATAM: { continent: 'Americas', country: null, language: 'es' },
  Vietnam: { continent: 'Asia', country: 'Vietnam', language: 'vi' },
  Europe: { continent: 'Europe', country: null, language: 'en' },
  Global: { continent: 'Global', country: null, language: 'en' },
}

export async function POST(req: NextRequest) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    name, slug, plan, logo_url, admin_name, admin_email, admin_password,
    max_seats, max_leads_per_month, custom_price, vendor,
    default_language, markets, internal_notes,
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
      default_language: default_language ?? 'zh',
      internal_notes: internal_notes ?? null,
      is_active: true,
      billing_day: 1,
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

  // 4. Insert organization markets
  if (Array.isArray(markets) && markets.length > 0) {
    const marketRows = markets
      .filter((m: string) => MARKET_MAP[m])
      .map((m: string) => ({
        organization_id: org.id,
        continent: MARKET_MAP[m].continent,
        country: MARKET_MAP[m].country,
        language: MARKET_MAP[m].language,
      }))

    if (marketRows.length > 0) {
      await admin.from('organization_markets').insert(marketRows)
    }
  }

  return NextResponse.json({ ok: true, org_id: org.id })
}
