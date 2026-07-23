'use client'

import { useEffect, useState } from 'react'
import { buildMarketAreaMap, type MarketAreaMap } from '@/lib/utils/area-inference'
import type { Market } from '@/lib/types'

/**
 * market name → area lookup, built once from the full market catalogue.
 *
 * Uses the whole catalogue rather than the org's activated markets so that a
 * historical run still resolves its area after the org deactivates that market.
 */
export function useMarketAreaMap(): MarketAreaMap {
  const [map, setMap] = useState<MarketAreaMap>({})

  useEffect(() => {
    let cancelled = false
    fetch('/api/markets')
      .then(r => r.json())
      .then((data: Market[]) => {
        if (!cancelled && Array.isArray(data)) setMap(buildMarketAreaMap(data))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return map
}
