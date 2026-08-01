import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { normalizeAnthropicBaseUrl } from '@/lib/utils/anthropic'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getCaller() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('role, organization_id').eq('id', user.id).single()
  if (!profile) return null
  return { userId: user.id, role: profile.role as string, organizationId: profile.organization_id as string | null }
}

// Same default used when handing the org's Anthropic config to the scraper
// backend (src/app/api/runs/route.ts) — this is a resale/proxy gateway, not
// api.anthropic.com directly, but speaks the same Messages API shape.
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.aitokenking.com.tw/api/v1'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5'

// POST /api/prospects/[id]/translate
// Body: { field: 'custom1' | 'custom2', targetLanguage: string }
//
// Translates an already-generated outreach message into any language the
// caller types in (not a fixed dropdown of a dozen languages — the point of
// this feature is covering diaspora cases like a Vietnamese speaker settled
// in Taiwan, which a short hardcoded list would miss). Uses the org's OWN
// Anthropic key/base_url/model (same columns already used to generate
// custom1/custom2 in the first place, see organizations.anthropic_key) —
// deliberately not a new third-party vendor: the message text (which
// contains the lead's name/company/title) never leaves a processor this
// org has already agreed to send that same data to for message generation.
//
// The key itself never reaches the browser — this route resolves it
// server-side with the service-role client and only ever returns the
// translated text.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { field?: string; targetLanguage?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { field, targetLanguage } = body
  if (field !== 'custom1' && field !== 'custom2') {
    return NextResponse.json({ error: 'field must be custom1 or custom2' }, { status: 400 })
  }
  if (!targetLanguage || !targetLanguage.trim()) {
    return NextResponse.json({ error: 'targetLanguage is required' }, { status: 400 })
  }

  const db = adminClient()

  const { data: prospect, error: prospectErr } = await db
    .from('prospects')
    .select('id, organization_id, assigned_to, custom1, custom2')
    .eq('id', id)
    .single()

  if (prospectErr || !prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  }

  // Mirrors the live prospects_select RLS condition: admin_global always,
  // an org admin within their own org, or the SDR this prospect is
  // assigned to. Enforced here explicitly because this route runs on the
  // service-role client and bypasses RLS entirely.
  const sameOrg = prospect.organization_id === caller.organizationId
  const allowed =
    caller.role === 'admin_global' ||
    (caller.role === 'admin' && sameOrg) ||
    (prospect.assigned_to === caller.userId && sameOrg)

  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sourceText = (prospect as Record<string, string | null>)[field]
  if (!sourceText || !sourceText.trim()) {
    return NextResponse.json({ error: 'Nothing to translate' }, { status: 400 })
  }

  const { data: org } = await db
    .from('organizations')
    .select('anthropic_key, anthropic_base_url, anthropic_model')
    .eq('id', prospect.organization_id)
    .single()

  if (!org?.anthropic_key) {
    return NextResponse.json({ error: 'not_configured' }, { status: 400 })
  }

  const base = normalizeAnthropicBaseUrl(org.anthropic_base_url) ?? DEFAULT_ANTHROPIC_BASE_URL
  const model = org.anthropic_model ?? DEFAULT_ANTHROPIC_MODEL

  const system =
    'You are a professional translator for a B2B sales outreach team. ' +
    `Translate the user\'s message into ${targetLanguage.trim()}. ` +
    'Preserve the tone, formality, line breaks, and any placeholder tokens ' +
    '(e.g. {{first_name}}) exactly as they are — do not translate placeholder ' +
    'names themselves. Output ONLY the translated text: no preamble, no ' +
    'quotation marks, no explanation, no language name.'

  let anthropicRes: Response
  try {
    anthropicRes = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': org.anthropic_key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: sourceText }],
      }),
    })
  } catch {
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 })
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => '')
    console.error(`[translate] Anthropic gateway ${anthropicRes.status}: ${detail}`)
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 })
  }

  const data = await anthropicRes.json().catch(() => null)
  const translated = data?.content?.[0]?.text
  if (typeof translated !== 'string' || !translated.trim()) {
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 })
  }

  return NextResponse.json({ translated: translated.trim(), targetLanguage: targetLanguage.trim() })
}
