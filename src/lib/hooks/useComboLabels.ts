'use client'

import { useEffect, useState } from 'react'
import type { ScraperComboMaster } from '@/lib/types'

// Shared across every caller — a Kanban board with hundreds of cards used to
// fire one independent fetch('/api/scraper-combos') per ProspectCard (every
// caller had its own useState/useEffect with no cache between them), flooding
// the network with duplicate identical requests. Now the fetch happens once
// per browser session and every hook instance subscribes to the same result.
let cachedLabels: Record<string, string> | null = null
let inFlight: Promise<Record<string, string>> | null = null
const subscribers = new Set<(labels: Record<string, string>) => void>()

function loadComboLabels(): Promise<Record<string, string>> {
  if (cachedLabels) return Promise.resolve(cachedLabels)
  if (!inFlight) {
    inFlight = fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => {
        const labels = Array.isArray(data) ? Object.fromEntries(data.map(c => [c.code, c.name])) : {}
        cachedLabels = labels
        subscribers.forEach(fn => fn(labels))
        return labels
      })
      .catch(() => {
        const labels: Record<string, string> = {}
        cachedLabels = labels
        return labels
      })
  }
  return inFlight
}

/**
 * combo code (e.g. "combo_D") -> human-readable name (e.g. "CTO / VP Engineering").
 *
 * History and Leads both used to render the raw code (FUNC-F1) since neither
 * fetched the combos catalogue that already exists for New Run's picker.
 * `code` is looked up as-is, falling back to itself for a combo that's since
 * been deactivated org-wide and dropped from `/api/scraper-combos`.
 */
export function useComboLabels() {
  const [labels, setLabels] = useState<Record<string, string>>(cachedLabels ?? {})

  useEffect(() => {
    // Already resolved by the time this instance mounted — the useState
    // initializer above already picked it up, nothing more to do here.
    if (cachedLabels) return
    subscribers.add(setLabels)
    loadComboLabels()
    return () => { subscribers.delete(setLabels) }
  }, [])

  return labels
}
