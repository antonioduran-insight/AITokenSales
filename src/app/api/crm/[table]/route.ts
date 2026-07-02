import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_TABLES = ['prospects', 'notes', 'conversations', 'audit_log', 'users', 'areas', 'support_tickets']

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const { searchParams } = new URL(req.url)

  if (!ALLOWED_TABLES.includes(table)) {
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })
  }

  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const select = searchParams.get('select') || '*'
  const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 2000)
  const offset = parseInt(searchParams.get('offset') || '0')
  const orderCol = searchParams.get('order') || 'created_at'
  const orderAsc = searchParams.get('order_dir') === 'asc'

  if (impersonateOrgId) {
    // Verify caller is admin_global
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (userData?.role !== 'admin_global') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const adminClient = createAdminClient()
    const { data, error, count } = await adminClient
      .from(table)
      .select(select, { count: 'exact' })
      .eq('organization_id', impersonateOrgId)
      .order(orderCol, { ascending: orderAsc })
      .range(offset, offset + limit - 1)

    return NextResponse.json({ data, error, count })
  }

  // Without impersonate — use normal client with RLS
  const supabase = await createClient()
  const { data, error, count } = await supabase
    .from(table)
    .select(select, { count: 'exact' })
    .order(orderCol, { ascending: orderAsc })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ data, error, count })
}
