import { NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'

const locales = ['zh', 'en', 'vi', 'es']
const defaultLocale = 'zh'
const publicPages = ['/login']
const publicPaths = ['/landing']

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always'
})

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const pathnameHasLocale = locales.some(
    locale => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  )

  const isPublicPage = publicPages.some(page =>
    locales.some(locale => pathname === `/${locale}${page}` || pathname === page)
  )

  if (isPublicPage) return intlMiddleware(request)

  // Fully public paths (no locale, no auth required)
  if (publicPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  // Auth check
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const locale = pathnameHasLocale ? pathname.split('/')[1] : defaultLocale
    const redirectResponse = NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    // Relay whatever Supabase wrote to `response` (e.g. clearing an invalid
    // session) so the browser doesn't keep resending stale cookies.
    response.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  const intlResponse = intlMiddleware(request)

  // `intlResponse` is a separate NextResponse from `response` above, so it
  // doesn't carry whatever Supabase just refreshed on `response` inside
  // setAll(). Without copying those cookies over, a rotated session cookie
  // never reaches the browser — the browser keeps sending the old, now
  // server-invalidated refresh token, which makes the very next request's
  // getUser() fail and forces a login redirect (the "logged out on every
  // navigation" bug). intlMiddleware's own response (locale rewrite/
  // redirect, NEXT_LOCALE cookie) is preserved; we're only layering
  // Supabase's cookies on top.
  response.cookies.getAll().forEach(cookie => intlResponse.cookies.set(cookie))

  // Fetch profile to expose role + org_id via cookies, and to enforce
  // is_active (QA-F1) — race against 900ms to avoid
  // MIDDLEWARE_INVOCATION_TIMEOUT on slow Supabase responses.
  //
  // A deactivated user/org still has a perfectly valid Supabase Auth
  // session (is_active lives in our own tables, decoupled from Auth), so
  // without this check a deactivated account would keep working normally
  // until its JWT happened to expire. This runs on every navigation, so a
  // deactivation takes effect on the very next request under normal
  // conditions.
  //
  // On a timeout (userData stays null) this deliberately fails OPEN —
  // same tradeoff the existing 900ms race already makes for role/org
  // cookies. Failing closed here would mean any transient Supabase
  // slowness force-logs-out active users, which is exactly the
  // "logged out constantly" class of bug already fixed once this
  // session; a rare, brief window where a just-deactivated account
  // isn't caught on one single slow request is the safer tradeoff.
  const userData = await Promise.race([
    supabase
      .from('users')
      .select('role, organization_id, is_active, organizations(is_active)')
      .eq('id', user.id)
      .single()
      .then(r => r.data),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 900)),
  ])

  if (userData) {
    // Supabase types this embedded relation as an array regardless of the
    // FK's actual to-one cardinality — a user belongs to at most one org.
    const orgs = userData.organizations as unknown as { is_active: boolean }[] | null
    const orgInactive = !!orgs && orgs.length > 0 && !orgs[0].is_active
    const deactivated = !userData.is_active ? 'user' : (orgInactive ? 'org' : null)

    if (deactivated) {
      await supabase.auth.signOut()
      const locale = pathnameHasLocale ? pathname.split('/')[1] : defaultLocale
      const redirectResponse = NextResponse.redirect(new URL(`/${locale}/login?deactivated=${deactivated}`, request.url))
      response.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }

    // Support is org-independent internal staff — its only job is the
    // ticket queue, so it must never see the rest of the CRM (Kanban,
    // Prospects, etc. would just render empty/broken for an org-less user
    // anyway, since every query there is organization_id-scoped).
    if (userData.role === 'support') {
      const locale = pathnameHasLocale ? pathname.split('/')[1] : defaultLocale
      const pathAfterLocale = pathnameHasLocale ? pathname.slice(`/${locale}`.length) || '/' : pathname
      if (pathAfterLocale !== '/support') {
        const redirectResponse = NextResponse.redirect(new URL(`/${locale}/support`, request.url))
        response.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
        return redirectResponse
      }
    }

    intlResponse.cookies.set('user_role',   userData.role ?? '',             { path: '/', sameSite: 'lax' })
    intlResponse.cookies.set('user_org_id', userData.organization_id ?? '', { path: '/', sameSite: 'lax' })
  }
  return intlResponse
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)']
}
