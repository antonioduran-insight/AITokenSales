'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import type { Market } from '@/lib/types'

/**
 * The markets the current organization has activated in Settings.
 *
 * Used by every surface that asks the user to pick a market (New Run, Bridge
 * seed lists) so they all offer the same org-specific list instead of a
 * hardcoded one.
 */
export function useOrgMarkets() {
  const { user } = useUser()
  const orgId = user?.organization_id ?? null

  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId) { setMarkets([]); setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}/markets`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not load markets')
      setMarkets(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) {
      setMarkets([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  return { markets, loading, error, orgId, reload }
}
