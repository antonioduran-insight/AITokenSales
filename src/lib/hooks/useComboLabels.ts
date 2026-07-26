'use client'

import { useEffect, useState } from 'react'
import type { ScraperComboMaster } from '@/lib/types'

/**
 * combo code (e.g. "combo_D") -> human-readable name (e.g. "CTO / VP Engineering").
 *
 * History and Leads both used to render the raw code (FUNC-F1) since neither
 * fetched the combos catalogue that already exists for New Run's picker.
 * `code` is looked up as-is, falling back to itself for a combo that's since
 * been deactivated org-wide and dropped from `/api/scraper-combos`.
 */
export function useComboLabels() {
  const [labels, setLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => {
        if (!Array.isArray(data)) return
        setLabels(Object.fromEntries(data.map(c => [c.code, c.name])))
      })
      .catch(() => {})
  }, [])

  return labels
}
