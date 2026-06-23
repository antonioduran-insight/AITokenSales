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
    .select('id, role, area_id')
    .eq('id', user.id)
    .single()
  return profile ?? null
}

// POST /api/import/check — dedup check across the full area (bypasses RLS)
// Body: { area_id: string, emails: string[], linkedins: string[] }
export async function POST(req: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { area_id, emails, linkedins } = await req.json()
  if (!area_id) return NextResponse.json({ error: 'Missing area_id' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch ALL prospects in this area (service role — no RLS)
  const { data: existing } = await admin
    .from('prospects')
    .select('id, name, email, linkedin_url')
    .eq('area_id', area_id)

  const emailMap: Record<string, string> = {}
  const linkedinMap: Record<string, string> = {}
  existing?.forEach(p => {
    if (p.email) emailMap[p.email.toLowerCase()] = p.name
    if (p.linkedin_url) linkedinMap[p.linkedin_url.toLowerCase()] = p.name
  })

  // Return which emails/linkedins are duplicates
  const dupEmails: Record<string, string> = {}
  const dupLinkedins: Record<string, string> = {}
  for (const e of (emails ?? [])) {
    const key = e.toLowerCase()
    if (emailMap[key]) dupEmails[key] = emailMap[key]
  }
  for (const l of (linkedins ?? [])) {
    const key = l.toLowerCase()
    if (linkedinMap[key]) dupLinkedins[key] = linkedinMap[key]
  }

  return NextResponse.json({ dupEmails, dupLinkedins })
}

// PUT /api/import — insert records (bypasses RLS)
// Body: { records: ProspectRecord[] }
export async function PUT(req: NextRequest) {
  const caller = await getCallerProfile()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { records } = await req.json()
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'No records to insert' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let imported = 0
  let skippedConstraint = 0
  const errors: string[] = []

  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    const { error, data } = await admin.from('prospects').insert(batch).select('id')
    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation in batch — retry one by one to skip only conflicts
        for (const record of batch) {
          const { error: e, data: d } = await admin.from('prospects').insert(record).select('id')
          if (!e) {
            imported += d?.length ?? 0
          } else if (e.code === '23505') {
            skippedConstraint++
          } else {
            errors.push(e.message)
          }
        }
      } else {
        errors.push(error.message)
      }
    } else {
      imported += data?.length ?? 0
    }
  }

  if (errors.length > 0 && imported === 0 && skippedConstraint === 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 })
  }

  return NextResponse.json({ ok: true, imported, skippedConstraint, errors })
}
