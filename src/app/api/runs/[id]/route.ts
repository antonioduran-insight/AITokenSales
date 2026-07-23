import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { backendHeaders } from '@/lib/scraper-backend'

const SCRAPER_API = process.env.SCRAPER_API_URL ?? ''

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Run status + result summary. Used by New Run Phase 2 polling and Phase 3.
export async function GET(
  _req: NextRequest,
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

  if (!userData?.organization_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = adminClient()

  const { data: run, error } = await admin
    .from('runs')
    .select('*, executor:users!executed_by(full_name), run_sdr_assignments(sdr_id, leads_assigned, assigned_markets, user:users(full_name))')
    .eq('id', id)
    .single()

  if (error || !run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.organization_id !== userData.organization_id && userData.role !== 'admin_global') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Temperature breakdown + total generated
  const { data: leadRows } = await admin
    .from('scraper_leads')
    .select('temperature')
    .eq('run_id', id)

  const temperature = { HOT: 0, WARM: 0, COLD: 0 }
  for (const l of leadRows ?? []) {
    const t = (l.temperature ?? '').toUpperCase()
    if (t === 'HOT') temperature.HOT++
    else if (t === 'WARM') temperature.WARM++
    else temperature.COLD++
  }

  return NextResponse.json({
    ...run,
    leads_generated: leadRows?.length ?? 0,
    temperature,
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: verify caller is logged in and get their org
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.organization_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = adminClient()

  // Use admin client so RLS never blocks us
  const { data: run, error: fetchError } = await admin
    .from('runs')
    .select('id, status, organization_id')
    .eq('id', id)
    .single()

  if (fetchError || !run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // Org ownership check (manual, since we bypassed RLS)
  if (run.organization_id !== userData.organization_id && userData.role !== 'admin_global') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cancellable = new Set(['pending', 'running', 'scoring', 'drafting'])
  if (!cancellable.has(run.status)) {
    return NextResponse.json({ error: 'Run is not cancellable' }, { status: 400 })
  }

  const { error: updateError } = await admin
    .from('runs')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Best-effort: tell Railway to stop processing
  if (SCRAPER_API) {
    fetch(`${SCRAPER_API}/runs/${id}`, { method: 'DELETE', headers: backendHeaders() }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
