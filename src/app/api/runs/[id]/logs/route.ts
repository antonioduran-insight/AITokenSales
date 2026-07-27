import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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

  // Scraper is admin-only (SDRs have no access at all) — org-membership
  // alone let any org-mate read a run's live logs by id (QA-F35 audit).
  if (!userData?.organization_id || (userData.role !== 'admin' && userData.role !== 'admin_global')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: runId } = await params
  const admin = adminClient()

  // Verify run belongs to caller's org
  const { data: run } = await admin
    .from('runs')
    .select('id, status, organization_id, total_leads_requested')
    .eq('id', runId)
    .single()

  if (!run || (run.organization_id !== userData.organization_id && userData.role !== 'admin_global')) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  // Logs (written by the backend into run_logs)
  const { data: logs } = await admin
    .from('run_logs')
    .select('id, run_id, level, message, created_at')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })

  // How many leads have been generated so far
  const { count: leadsGenerated } = await admin
    .from('scraper_leads')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)

  return NextResponse.json({
    run_id: runId,
    status: run.status,
    total_leads_requested: run.total_leads_requested,
    leads_generated: leadsGenerated ?? 0,
    logs: logs ?? [],
  })
}
