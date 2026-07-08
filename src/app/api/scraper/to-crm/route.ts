import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

async function getCallerProfile() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single()
  return profile ?? null
}

// POST /api/scraper/to-crm
// Body: { run_id, area_id, assigned_to? }
export async function POST(req: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { run_id, area_id, assigned_to } = await req.json()
  if (!run_id || !area_id) return NextResponse.json({ error: 'run_id y area_id requeridos' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch leads from Supabase scraper_leads table
  const { data: leads, error: leadsError } = await admin
    .from('scraper_leads')
    .select('*')
    .eq('run_id', run_id)
    .eq('exported_to_crm', false)

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })
  if (!leads || leads.length === 0) return NextResponse.json({ imported: 0, duplicates: 0, no_name: 0 })

  // Fetch existing prospects in area for dedup
  const { data: existing } = await admin
    .from('prospects')
    .select('email, linkedin_url')
    .eq('area_id', area_id)

  const existingEmails = new Set<string>(
    existing?.filter(p => p.email).map(p => (p.email as string).toLowerCase()) ?? []
  )
  const existingLinkedins = new Set<string>(
    existing?.filter(p => p.linkedin_url).map(p => (p.linkedin_url as string).toLowerCase()) ?? []
  )

  let imported = 0
  let duplicates = 0
  let no_name = 0

  const toInsert: Record<string, unknown>[] = []
  const importedLeadIds: string[] = []

  for (const lead of leads) {
    const name = (lead.full_name as string | undefined)?.trim()
    if (!name) { no_name++; continue }

    const email = (lead.email as string | undefined)?.toLowerCase()
    const linkedin = (lead.linkedin_url as string | undefined)?.toLowerCase()

    if ((email && existingEmails.has(email)) || (linkedin && existingLinkedins.has(linkedin))) {
      duplicates++
      continue
    }

    toInsert.push({
      name,
      linkedin_url: lead.linkedin_url || null,
      email: lead.email || null,
      company: lead.company || null,
      title: lead.title || null,
      industry: lead.industry || null,
      company_size: lead.company_size || null,
      icp_score: lead.icp_score ?? null,
      lead_temperature: lead.temperature || null,
      search_combo: lead.search_combo || null,
      custom1: lead.custom1 || null,
      custom2: lead.custom2 || null,
      market: lead.market || null,
      source: 'scraper',
      outreach_status: 'new',
      area_id,
      assigned_to: assigned_to || null,
      organization_id: caller.organization_id ?? null,
      flag_tomorrow: false,
    })
    importedLeadIds.push(lead.id)

    if (email) existingEmails.add(email)
    if (linkedin) existingLinkedins.add(linkedin)
  }

  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100)
    const { data, error } = await admin.from('prospects').insert(batch).select('id')
    if (!error) {
      imported += data?.length ?? 0
    } else if (error.code === '23505') {
      for (const record of batch) {
        const { data: d, error: e } = await admin.from('prospects').insert(record).select('id')
        if (!e) { imported += d?.length ?? 0 }
        else if (e.code === '23505') { duplicates++ }
      }
    }
  }

  // Mark leads as exported
  if (importedLeadIds.length > 0) {
    await admin.from('scraper_leads').update({ exported_to_crm: true }).in('id', importedLeadIds)
  }

  // Increment monthly lead counter
  if (imported > 0 && caller.organization_id) {
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).rpc('increment_monthly_leads', {
      p_org_id: caller.organization_id,
      p_year_month: yearMonth,
      p_count: imported,
    }).catch(() => {
      // RPC or table not yet applied — non-fatal
    })
  }

  return NextResponse.json({ imported, duplicates, no_name })
}
