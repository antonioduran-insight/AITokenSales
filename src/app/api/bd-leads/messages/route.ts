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

  const admin = adminClient()

  const { data: leads, error } = await admin
    .from('scraper_leads')
    .select('id, run_id, organization_id, lead_type, verification_status, custom1')
    .in('id', lead_ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  if (!SCRAPER_API) {
    return NextResponse.json({ error: 'Scraper backend is not configured' }, { status: 500 })
  }

  // The backend endpoint is scoped per run_id, so group and call once per run
  const byRun: Record<string, string[]> = {}
  for (const l of eligible) {
    byRun[l.run_id] = byRun[l.run_id] ?? []
    byRun[l.run_id].push(l.id)
  }

  const results: { run_id: string; ok: boolean; error?: string }[] = []
  for (const runId of Object.keys(byRun)) {
    try {
      const res = await fetch(`${SCRAPER_API}/bd-runs/${runId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: userData.organization_id, lead_ids: byRun[runId] }),
      })
      if (!res.ok) {
        results.push({ run_id: runId, ok: false, error: await res.text() })
      } else {
        results.push({ run_id: runId, ok: true })
      }
    } catch (e) {
      results.push({ run_id: runId, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ results })
}
