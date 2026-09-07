import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireGlobalAdmin } from '@/lib/utils/route-guard'

export async function POST(req: NextRequest) {
  const auth = await requireGlobalAdmin()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id, org_name } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  // Log to audit_log
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    await admin.from('audit_log').insert({
      actor_id: auth.id,
      // Name snapshotted rather than joined, so the audit row still reads
      // correctly after the staff account is gone. Email as the fallback,
      // 'global-admin' as the last resort.
      actor_name: auth.full_name ?? auth.email ?? 'global-admin',
      event_type: 'prospect_created',
      prospect_id: null,
      prospect_name: null,
      metadata: { action: 'impersonate', org_id, org_name },
    })
  } catch {
    // Non-critical — continue even if logging fails
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('impersonate_org', JSON.stringify({ id: org_id, name: org_name }), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
  })
  return response
}

export async function DELETE(_req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('impersonate_org', '', {
    path: '/',
    maxAge: 0,
    httpOnly: false,
    sameSite: 'lax',
  })
  return response
}
