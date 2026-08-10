import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { provisionSsoUser } from '@/lib/utils/sso-provision'

/**
 * Landing point for every link Supabase emails out — today an invitation,
 * tomorrow a password recovery. Turns the one-time token in the URL into a
 * real session cookie, then sends the person on to set a password.
 *
 * NOT under `[locale]`, and that is deliberate: this URL is baked into emails
 * that were already sent, so it has to keep working regardless of which
 * language the recipient later browses in. The locale is carried as a query
 * parameter and only used to pick where to redirect afterwards.
 *
 * `middleware.ts` lets it through via `publicPaths` — the locale-free
 * exemption list that existed empty, waiting for exactly this.
 *
 * TWO TOKEN SHAPES, both handled on purpose:
 *   - `?code=…`        the PKCE flow, exchanged for a session
 *   - `?token_hash=…&type=…`  the older verify flow
 * Which one Supabase sends depends on the project's email template, and a
 * template edited months from now must not silently break invitations. Trying
 * both costs one branch; guessing wrong costs a customer who cannot log in.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const locale = url.searchParams.get('locale') || 'zh'

  const cookieStore = await cookies()
  // `const` even though setAll() writes into it: cookies are set ON the
  // response object, the binding itself is never replaced.
  const response = NextResponse.redirect(new URL(`/${locale}/set-password`, url.origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  let failed: string | null = null

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) failed = error.message
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'invite' | 'recovery' | 'email',
      token_hash: tokenHash,
    })
    if (error) failed = error.message
  } else {
    failed = 'missing token'
  }

  if (failed) {
    // Straight to login with a flag, never a blank page. An expired invite is
    // the most likely reason someone lands here failing, and "ask your admin
    // to send it again" is only actionable if they are told at all.
    const dest = new URL(`/${locale}/login`, url.origin)
    dest.searchParams.set('invite_error', '1')
    const errResponse = NextResponse.redirect(dest)
    // Carry over anything Supabase wrote (e.g. clearing a bad session).
    response.cookies.getAll().forEach(c => errResponse.cookies.set(c))
    return errResponse
  }

  // ── SSO takes a different exit ──────────────────────────────────────────
  //
  // An invitation or a recovery ends at /set-password, because that is the
  // point: choose one. Someone arriving from their company's IdP has no
  // password and never will, so sending them there would show a form they
  // cannot meaningfully fill in.
  //
  // They also might not have a profile yet — this may be their first ever
  // login — so this is where the roster is consumed.
  const { data: { user } } = await supabase.auth.getUser()
  const isSso = (user?.identities ?? []).some(i => i.provider?.startsWith('sso'))

  if (user && isSso) {
    const outcome = await provisionSsoUser(user.id, user.email ?? '')

    if (outcome !== 'ok') {
      // Signed out on purpose. Leaving a valid session attached to a user with
      // no profile is the orphaned state this codebase has been bitten by
      // repeatedly: they'd land in the CRM with no role and no organisation,
      // and every page would render empty instead of explaining anything.
      await supabase.auth.signOut()
      const dest = new URL(`/${locale}/login`, url.origin)
      dest.searchParams.set('sso_error', outcome)
      const errResponse = NextResponse.redirect(dest)
      response.cookies.getAll().forEach(c => errResponse.cookies.set(c))
      return errResponse
    }

    const okResponse = NextResponse.redirect(new URL(`/${locale}/kanban`, url.origin))
    response.cookies.getAll().forEach(c => okResponse.cookies.set(c))
    return okResponse
  }

  return response
}
