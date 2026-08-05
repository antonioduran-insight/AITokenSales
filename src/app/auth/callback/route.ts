import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

  return response
}
