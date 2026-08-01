import { NextRequest, NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'

const locales = ['zh', 'en', 'vi', 'es']
const defaultLocale = 'zh'
// Locale-aware and unauthenticated: /zh/landing, /en/landing, ...
// The landing moved under [locale] so it can be translated like everything
// else; while it lived at a bare /landing it could only ever be English.
// It's a standalone destination now, not where bare "/" goes (see below) —
// reached only via its own explicit URL (shared link, ad, etc.).
const publicPages = ['/login', '/landing']
// Fully public and locale-free. Empty now, kept because the check below is
// still the right shape for anything that must bypass the locale prefix.
const publicPaths: string[] = []

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always'
})

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Bare, locale-less root goes straight to login (in the default locale,
  // 'zh') — same as any other unauthenticated app route, handled by the
  // normal auth check below. The landing page is a separate, explicit
  // destination now (/{locale}/landing) — it no longer lives at "/", so
  // this file has nothing special to do for the bare-root case.
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

    // `admin_global` has no CRM data of its own — every CRM page it opens is
    // somebody else's org. Its RLS policies are cross-org, so a bare
    // `/zh/prospects` (no `?impersonate_org_id=`) rendered the union of every
    // organization's prospects, with no column saying who owns which lead and
    // every drawer field editable (P1, reproduced in production).
    //
    // Impersonation is the only sanctioned way in: it scopes reads through
    // `/api/crm/[table]` with an explicit org id and flips the client into
    // read-only. The client-side `isReadOnly` flag in `useOrgId` only stops
    // *writes* — the reads still ran under admin_global's RLS — so this has to
    // be a route-level redirect, not just a UI guard.
    //
    // NOTE: like the `support` gate above, this inherits the 900ms fail-open
    // of the profile read — on a timeout `userData` is null and this whole
    // block is skipped, so a bare CRM URL still gets through on that one
    // request. That is the deliberate tradeoff documented above and is left
    // alone here; `useOrgId`'s `isReadOnly` is the second layer covering it.
    if (userData.role === 'admin_global') {
      const locale = pathnameHasLocale ? pathname.split('/')[1] : defaultLocale
      const pathAfterLocale = pathnameHasLocale ? pathname.slice(`/${locale}`.length) || '/' : pathname

      // Global Admin's own panel — must never be gated, it's the redirect
      // target (and `/global-admin/...` subpaths link back into it), so
      // gating it would be an infinite redirect loop. Matched exactly, not
      // by a bare `startsWith`, so a lookalike path can't slip past.
      const isGlobalAdminPanel =
        pathAfterLocale === '/global-admin' || pathAfterLocale.startsWith('/global-admin/')

      // The CRM ticket queue is deliberately cross-org for `admin_global`:
      // both `src/app/[locale]/support/page.tsx` and `/api/support/tickets`
      // branch on `role === 'admin_global'` to show every org's tickets and
      // to allow status changes/replies. It's the one CRM route this role is
      // *meant* to open without impersonating, and `/global-admin/support` is
      // a different page (internal staff accounts, no ticket queue), so it
      // can't be substituted.
      const isSupportQueue = pathAfterLocale === '/support'

      // An empty value counts as absent: `useOrgId` does `!!impersonateOrgId`,
      // so letting `?impersonate_org_id=` through would hand back exactly the
      // fully-writable cross-org CRM this gate exists to stop.
      const isImpersonating = !!request.nextUrl.searchParams.get('impersonate_org_id')

      if (!isGlobalAdminPanel && !isSupportQueue && !isImpersonating) {
        const redirectResponse = NextResponse.redirect(new URL(`/${locale}/global-admin/organizations`, request.url))
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
