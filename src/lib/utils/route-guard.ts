import { redirect } from 'next/navigation'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

/**
 * Route-level gate for pages that must never render — not even an empty
 * shell — for the `sdr` role (FUNC-F12). RLS alone stops SDRs from seeing
 * other orgs'/areas' data, but an empty page that still mounts is a fragile
 * second layer: any future component on that page doing a service-role
 * fetch or showing an aggregate count could leak data without anyone
 * noticing. Call this at the top of a server component page before
 * rendering anything, mirroring `GlobalAdminLayout`'s SSR check.
 */
export async function blockSdrAccess(locale: string) {
  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/login`)
  if (user.role === 'sdr') redirect(`/${locale}/kanban`)
}

/**
 * Route-level gate for pages that only exist when an add-on is active.
 *
 * `blockSdrAccess` only stops the `sdr` role, so before this an **admin whose
 * org does not have the add-on** could type the URL and get the whole page
 * mounted — every fetch inside it then failing with the proxy's 403. Not a
 * data leak (the API is the real boundary and it re-checks server-side), but
 * the same FUNC-F12 fragility the SDR guard exists to prevent: a page that
 * renders for someone who shouldn't be there is one future service-role
 * fetch away from becoming one.
 *
 * Deliberately does NOT use the admin client: `organization_addons` has an
 * RLS policy letting a member read their own org's rows, so the session
 * client is enough and the org scoping is enforced by the database rather
 * than by this function remembering to filter correctly.
 *
 * `admin_global` has no `organization_id`, so it never passes this — which is
 * the intended behaviour for Bridge, hidden during impersonation by design.
 *
 * Call AFTER `blockSdrAccess` so an SDR lands on their board rather than
 * being told an add-on is missing.
 */
export async function requireAddon(locale: string, addonType: string) {
  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/login`)
  if (!user.organization_id) redirect(`/${locale}/kanban`)

  const supabase = await createClient()
  const { data } = await supabase
    .from('organization_addons')
    .select('id')
    .eq('organization_id', user.organization_id)
    .eq('addon_type', addonType)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) redirect(`/${locale}/kanban`)
}

/**
 * API-route gate for `admin_global`. Returns the caller's profile, or null.
 *
 * Note the different shape from the two guards above: those are for PAGES and
 * `redirect()` out of them, which throws. An API route has to answer with a
 * status code, so this returns null and the caller decides — usually a 401.
 *
 * Every `admin_global` route imports this one. Ten of them used to declare a
 * private copy each, and the copies had already drifted: seven differed only in
 * formatting, but two returned a different SHAPE because they needed the
 * actor's `full_name` for the audit trail, and a tenth returned just an id.
 * Nothing made them move together, and a global-admin route that gets this
 * check subtly wrong is a cross-tenant hole — so there is one.
 *
 * It returns the `public.users` PROFILE, not the auth user: same `id` (the
 * schema requires `users.id = auth.uid()`), plus `full_name`, `email` and
 * `role`, which is a superset of what any caller needed.
 */
export async function requireGlobalAdmin() {
  const user = await getCurrentUser()
  return user?.role === 'admin_global' ? user : null
}
