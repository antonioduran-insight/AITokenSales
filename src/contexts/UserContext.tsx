'use client'

import { createContext, useContext } from 'react'
import type { User, Area } from '@/lib/types'

export interface UserWithArea extends User {
  area?: Area
}

interface UserContextValue {
  user: UserWithArea | null
  isAdmin: boolean
  orgPlan: string  // 'basic' | 'premium' | 'enterprise' | 'ultra' | ''
}

const UserContext = createContext<UserContextValue>({ user: null, isAdmin: false, orgPlan: '' })

export function UserProvider({
  value,
  children,
}: {
  value: UserContextValue
  children: React.ReactNode
}) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  return useContext(UserContext)
}
