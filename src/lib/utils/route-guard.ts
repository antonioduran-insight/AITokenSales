import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'

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
