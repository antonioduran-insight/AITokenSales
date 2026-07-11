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
    fetch(`${SCRAPER_API}/runs/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
