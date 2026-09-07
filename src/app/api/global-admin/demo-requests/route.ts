import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

/**
 * Read and triage the leads captured by the public landing form.
 *
 * `demo_requests` has no organization_id — a prospect belongs to nobody yet —
 * so it sits outside the multi-tenant model and only `admin_global` may touch
 * it. RLS on the table already says so; this route verifies the caller's role
 * from the database anyway rather than trusting a cookie, matching every other
 * global-admin route here.
 */

const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'discarded'] as const

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  if (!(await requireGlobalAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await admin()
    .from('demo_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireGlobalAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, status, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  // Validated against the same list the CHECK constraint enforces, so a bad
  // value fails here with a clear message instead of as a Postgres error.
  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = status
  }
  if (notes !== undefined) patch.notes = typeof notes === 'string' ? notes.slice(0, 4000) : null

  const { data, error } = await admin()
    .from('demo_requests').update(patch).eq('id', id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
