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
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
  }

  // Fetch profile to expose role + org_id to client components via cookies
  const { data: userData } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const intlResponse = intlMiddleware(request)
  if (userData) {
    intlResponse.cookies.set('user_role',   userData.role ?? '',              { path: '/', sameSite: 'lax' })
    intlResponse.cookies.set('user_org_id', userData.organization_id ?? '',  { path: '/', sameSite: 'lax' })
  }
  return intlResponse
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)']
}
