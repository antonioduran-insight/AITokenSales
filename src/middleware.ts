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

  // Fetch profile to expose role + org_id via cookies — race against 900ms
  // to avoid MIDDLEWARE_INVOCATION_TIMEOUT on slow Supabase responses
  const userData = await Promise.race([
    supabase
      .from('users')
      .select('role, organization_id')
      .eq('id', user.id)
      .single()
      .then(r => r.data),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 900)),
  ])

  if (userData) {
    intlResponse.cookies.set('user_role',   userData.role ?? '',             { path: '/', sameSite: 'lax' })
    intlResponse.cookies.set('user_org_id', userData.organization_id ?? '', { path: '/', sameSite: 'lax' })
  }
  return intlResponse
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)']
}
