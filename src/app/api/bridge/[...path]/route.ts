import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const BACKEND = process.env.SCRAPER_API_URL || process.env.NEXT_PUBLIC_SCRAPER_API_URL || 'http://localhost:8000'

// Authenticated reverse proxy to the Bridge endpoints on the Python backend.
//
// The caller never supplies organization_id or apify_token: we resolve them
// from the session and inject them, so one org can't read or mutate another
// org's seed lists, runs or candidates.
async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  // Bridge is an admin-only tool.
  if (userData?.role !== 'admin' || !userData.organization_id) {
    return NextResponse.json({ error: 'Only the organization admin can use Bridge' }, { status: 403 })
  }
  const orgId = userData.organization_id as string

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Gate on the bridge add-on being active for this org.
  const { data: addon } = await admin
    .from('organization_addons')
    .select('id')
    .eq('organization_id', orgId)
    .eq('addon_type', 'bridge')
    .eq('is_active', true)
    .maybeSingle()

  if (!addon) {
    return NextResponse.json({ error: 'The Bridge add-on is not active for this organization' }, { status: 403 })
  }

  const { path } = await params
  const pathStr = '/bridge/' + path.join('/')

  // Always scope reads to this org.
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

    // Starting a Bridge run needs the org's Apify token, same as the scraper.
    if (pathStr === '/bridge/runs') {
      const { data: org } = await admin
        .from('organizations')
        .select('apify_token')
        .eq('id', orgId)
        .single()
      if (!org?.apify_token) {
        return NextResponse.json(
          { error: 'Apify token must be configured in Settings → Scraper before running Bridge.' },
          { status: 400 }
        )
      }
      body.apify_token = org.apify_token
    }

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

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const DELETE = proxy
