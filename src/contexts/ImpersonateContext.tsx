'use client'

import { createContext, useContext } from 'react'

interface ImpersonateContextType {
  impersonateOrgId: string | null
  impersonateOrgName: string | null
  isImpersonating: boolean
}

export const ImpersonateContext = createContext<ImpersonateContextType>({
  impersonateOrgId: null,
  impersonateOrgName: null,
  isImpersonating: false,
})

export function useImpersonate() {
  return useContext(ImpersonateContext)
}
