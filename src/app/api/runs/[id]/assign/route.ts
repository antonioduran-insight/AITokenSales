import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { assignRunLeads } from '@/lib/utils/run-assign'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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

  const { id: runId } = await params
  const body = await req.json()
  const { market, manual } = body
  // One SDR per run. `sdr_ids` still accepted (first element wins) for safety.
  const sdrId: string | null = body.sdr_id ?? body.sdr_ids?.[0] ?? null
  // New Run's Phase 1 now picks several countries within one region. Prefer
  // the full array; fall back to the legacy singular `market` (still sent by
  // History's "Send to another SDR", which only ever moves within one run's
  // original market).
  const assignedMarkets: string[] = Array.isArray(body.markets) && body.markets.length
    ? body.markets
    : (market ? [market] : [])

  if (!sdrId) {
    return NextResponse.json({ error: 'sdr_id is required' }, { status: 400 })
  }

  const result = await assignRunLeads({
    admin: adminClient(),
    runId,
    organizationId: userData.organization_id,
    sdrId,
    assignedMarkets,
    manual: manual === true,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, sdr_id: sdrId, assigned: result.assigned, queued: result.queued, skipped: result.skipped })
}
