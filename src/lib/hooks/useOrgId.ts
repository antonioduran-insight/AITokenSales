'use client'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'

export function useOrgId() {
  const searchParams = useSearchParams()
  const { user } = useUser()

  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const impersonateOrgName = searchParams.get('impersonate_org_name')
  const isImpersonating = !!impersonateOrgId

  // `admin_global` has no CRM data of its own — every CRM page it can reach is
  // somebody else's org. Nothing redirects it away from a bare CRM URL (the
  // middleware only gates `sdr`/`support`), so without this flag a Global Admin
  // browsing `/zh/prospects` with no `?impersonate_org_id=` got a fully
  // *writable* CRM across every org: `isImpersonating` is false there, so every
  // `if (isImpersonating) return` write guard was a no-op.
  const isGlobalAdmin = user?.role === 'admin_global'

  // Read-only is the DEFAULT for `admin_global`, not something impersonation
  // turns on. Gate every write path (mutations, edit inputs, create/delete
  // buttons, drag-and-drop) on this — never on `isImpersonating`, which stays
  // as-is because it also means "route reads through /api/crm/[table] with this
  // org id", a routing decision that must not fire for a bare CRM URL.
  const isReadOnly = isImpersonating || isGlobalAdmin

  const orgId = isImpersonating ? impersonateOrgId : null
  const isAdmin = isImpersonating || user?.role === 'admin'

  return { orgId, isImpersonating, isGlobalAdmin, isReadOnly, impersonateOrgId, impersonateOrgName, isAdmin }
}
