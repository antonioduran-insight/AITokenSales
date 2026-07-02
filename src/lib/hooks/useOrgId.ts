'use client'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'

export function useOrgId() {
  const searchParams = useSearchParams()
  const { user } = useUser()

  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const impersonateOrgName = searchParams.get('impersonate_org_name')
  const isImpersonating = !!impersonateOrgId

  const orgId = isImpersonating ? impersonateOrgId : null
  const isAdmin = isImpersonating || user?.role === 'admin'

  return { orgId, isImpersonating, impersonateOrgId, impersonateOrgName, isAdmin }
}
