import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const BACKEND = process.env.SCRAPER_API_URL || process.env.NEXT_PUBLIC_SCRAPER_API_URL || 'http://localhost:8000'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Authenticated reverse proxy to the Python scraper backend.
//
// Mirrors the hardening in /api/bridge/[...path]: the caller must be a signed-in
// org admin, `organization_id` is always derived from the session (never trusted
// from the client), and any run referenced in the path must belong to that org.
async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // 1 — active session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  // 2 — the scraper is admin-only; SDRs have no access at all
  if (userData?.role !== 'admin' || !userData.organization_id) {
    return NextResponse.json({ error: 'Only the organization admin can use the scraper' }, { status: 403 })
  }
  const orgId = userData.organization_id as string

  const { path } = await params
  const pathStr = '/' + path.join('/')

  // 4 — if the path targets a specific run (/runs/{id}, /runs/{id}/logs, …),
  // verify that run belongs to the caller's org before forwarding anything.
  if (path[0] === 'runs' && path[1] && UUID_RE.test(path[1])) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: run } = await admin
      .from('runs')
      .select('id, organization_id')
      .eq('id', path[1])
      .maybeSingle()

    // Same response for "missing" and "belongs to another org" — don't leak
    // whether a run id exists outside the caller's organization.
    if (!run || run.organization_id !== orgId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
  }

  // 3 — scope every request to the caller's org, overwriting anything supplied
  const search = new URLSearchParams(req.nextUrl.searchParams)
  search.set('organization_id', orgId)
  const url = `${BACKEND}${pathStr}?${search.toString()}`

  const init: RequestInit = { method: req.method, headers: { 'Content-Type': 'application/json' } }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? JSON.parse(raw) : {}
    } catch { body = {} }
    body.organization_id = orgId
    init.body = JSON.stringify(body)
  }

  try {
    const res = await fetch(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export const GET    = proxy
export const POST   = proxy
export const PATCH  = proxy
export const DELETE = proxy
