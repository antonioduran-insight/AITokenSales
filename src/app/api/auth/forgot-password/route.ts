import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { resetPasswordEmail } from '@/lib/email/templates'

/**
 * Request a password reset, and say plainly whether the address is known.
 *
 * WHY THIS TELLS THE TRUTH
 * ------------------------
 * The usual advice is to answer identically either way, so the form can't be
 * used to discover which addresses have accounts. That advice is written for
 * consumer products with open sign-up, where the account list is the secret.
 *
 * This is a closed B2B CRM: nobody self-registers, every account is created by
 * an admin, and the people using it already know their colleagues' work email
 * addresses. The thing being "protected" is something the audience knows
 * anyway — while the cost of hiding it is real and lands on every legitimate
 * user, who mistypes their address, sees "check your email", and waits for a
 * message that will never arrive.
 *
 * What is kept from the anti-enumeration playbook is the part that actually
 * matters: this is rate-limited, so it can't be used to test addresses in
 * bulk, and it never reveals anything beyond existence — no name, no role, no
 * organisation.
 *
 * The email is composed and sent by us through Resend, not by Supabase — see
 * src/lib/email/send.ts for why.
 */

// Same naive in-memory shape as /api/demo-request. Serverless means each
// instance keeps its own map, so this slows a script down rather than stopping
// a determined attacker. Deliberately tighter than the demo form's limit,
// because the only legitimate use is "I forgot my password" — nobody needs to
// ask five times in a minute.
const RECENT = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (RECENT.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  hits.push(now)
  RECENT.set(ip, hits)
  return hits.length > MAX_PER_WINDOW
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const locale = typeof body.locale === 'string' ? body.locale : 'zh'

  if (!email) return NextResponse.json({ error: 'email_required' }, { status: 400 })

  const admin = createAdminClient()

  // Looked up in `public.users`, not `auth.users`, on purpose. A row here means
  // a real CRM account; an auth row without a profile is the orphaned state
  // this project has hit before, and sending a reset for one would let someone
  // set a password on an account that can't be used for anything.
  // NOT `.maybeSingle()`. There is no unique index on `public.users.email`
  // (verified 05/08/2026 — the only unique index on that table is the primary
  // key), so two profiles can share an address. `maybeSingle()` raises on more
  // than one row, which would turn a duplicate into "no account with that
  // email" — telling someone with a perfectly valid account that they don't
  // have one.
  //
  // An active row wins over an inactive one, so a leftover deactivated
  // duplicate can't shadow the account the person actually uses.
  const { data: profiles } = await admin
    .from('users')
    .select('id, is_active')
    .eq('email', email)
    .order('is_active', { ascending: false })
    .limit(2)

  const profile = profiles?.[0]

  if (!profile) {
    return NextResponse.json({ found: false, reason: 'no_account' })
  }

  if ((profiles?.length ?? 0) > 1) {
    // Not fatal — the reset still goes out for the active one — but it means
    // two CRM profiles share an address, which nothing prevents today and
    // which will confuse anyone reading the users list.
    console.warn(`[forgot-password] more than one profile uses ${email}`)
  }

  // A deactivated account is deliberately told apart from a missing one. The
  // person exists and their address is right — resetting the password would
  // not let them in, and "check your email" would strand them waiting. The
  // actionable answer is to talk to their admin.
  if (!profile.is_active) {
    return NextResponse.json({ found: true, reason: 'deactivated' })
  }

  // `generateLink` mints the recovery link WITHOUT emailing anything, so the
  // message itself is ours to compose — in the recipient's language, from
  // strings that live in src/messages/*.json with the rest of the product.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${req.nextUrl.origin}/auth/callback?locale=${encodeURIComponent(locale)}`,
    },
  })

  if (linkError || !link?.properties?.action_link) {
    console.error(`[forgot-password] link generation failed for ${email}: ${linkError?.message}`)
    return NextResponse.json({ found: true, reason: 'send_failed' }, { status: 502 })
  }

  const mail = resetPasswordEmail(locale, link.properties.action_link)
  const sent = await sendEmail({ to: email, ...mail })

  if (!sent.ok) {
    console.error(`[forgot-password] send failed for ${email}: ${sent.error}`)
    return NextResponse.json({ found: true, reason: 'send_failed' }, { status: 502 })
  }

  return NextResponse.json({ found: true, reason: 'sent' })
}
