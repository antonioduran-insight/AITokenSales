'use client'
import { useUser } from '@/contexts/UserContext'

// admin_global isn't scoped to any one org's plan/add-ons today (see
// PremiumFeature's own `!plan` bypass) — same exception here rather than
// inventing different rules for add-on checks specifically.
export function useHasAddon(addonType: string): boolean {
  const { user, activeAddons } = useUser()
  if (user?.role === 'admin_global') return true
  return activeAddons.includes(addonType)
}
