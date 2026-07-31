import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * Public endpoint behind the landing page's demo form.
 *
 * This is the ONLY unauthenticated write in the app, so it is deliberately the
 * most defensive route here. `demo_requests` has no INSERT policy at all — a
 * prospect has no session and no organization, so there is nothing for RLS to
 * scope against. The write therefore goes through the service-role key, which
 * means every guard that would normally be RLS's job has to live in this file.
 */

const MAX = { full_name: 120, email: 200, company: 160, phone: 40, message: 2000 }

// Deliberately loose: the goal is to reject obvious junk, not to adjudicate
// what a valid address looks like. Over-strict validation silently drops real
// prospects, which is far more expensive than storing one bad row.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Naive in-memory throttle, keyed by IP. Serverless means each instance keeps
// its own map and it resets on cold start — so this is a speed bump against a
// script hammering the form, NOT real abuse protection. Anything stronger
// belongs in the Vercel WAF, which already sits in front of this.
const RECENT = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (RECENT.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  hits.push(now)
  RECENT.set(ip, hits)
  if (RECENT.size > 5000) RECENT.clear() // crude bound; see note above
  return hits.length > MAX_PER_WINDOW
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Honeypot: a field hidden from humans by CSS. Bots fill every input they
  // find, so anything here means automation. Answer 200 anyway — telling a
  // bot it was detected just teaches whoever wrote it to stop filling it.
  if (clean(body.website, 200)) {
    return NextResponse.json({ ok: true })
  }

  const full_name = clean(body.full_name, MAX.full_name)
  const email = clean(body.email, MAX.email)

  if (!full_name || !email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Name and a valid email are required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await admin.from('demo_requests').insert({
    full_name,
    email: email.toLowerCase(),
    company: clean(body.company, MAX.company),
    phone: clean(body.phone, MAX.phone),
    team_size: clean(body.team_size, 40),
    message: clean(body.message, MAX.message),
    locale: clean(body.locale, 8),
    source_path: clean(body.source_path, 200),
  })

  if (error) {
    // The prospect must never see a database error, and losing the lead
    // silently is worse than any of this — log loudly so a failed capture is
    // findable rather than invisible.
    console.error('[demo-request] insert failed:', error)
    return NextResponse.json({ error: 'Could not submit the request' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
