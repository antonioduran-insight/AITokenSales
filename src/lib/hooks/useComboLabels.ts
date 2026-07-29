'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ScraperComboMaster } from '@/lib/types'

// Shared across every caller — a Kanban board with hundreds of cards used to
// fire one independent fetch('/api/scraper-combos') per ProspectCard (every
// caller had its own useState/useEffect with no cache between them), flooding
// the network with duplicate identical requests. Now the fetch happens once
// per browser session and every hook instance subscribes to the same result.
//
// The cache holds the RAW rows, not just names: `name` and `description` both
// need to be reachable, and the translated label is derived at read time so a
// locale switch doesn't require refetching.
let cachedCombos: ScraperComboMaster[] | null = null
let inFlight: Promise<ScraperComboMaster[]> | null = null
const subscribers = new Set<(combos: ScraperComboMaster[]) => void>()

function loadCombos(): Promise<ScraperComboMaster[]> {
  if (cachedCombos) return Promise.resolve(cachedCombos)
  if (!inFlight) {
    inFlight = fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => {
        const rows = Array.isArray(data) ? data : []
        cachedCombos = rows
        subscribers.forEach(fn => fn(rows))
        return rows
      })
      .catch(() => {
        cachedCombos = []
        return []
      })
  }
  return inFlight
}

function useCombos(): ScraperComboMaster[] {
  const [combos, setCombos] = useState<ScraperComboMaster[]>(cachedCombos ?? [])

  useEffect(() => {
    // Already resolved by the time this instance mounted — the useState
    // initializer above already picked it up, nothing more to do here.
    if (cachedCombos) return
    subscribers.add(setCombos)
    loadCombos()
    return () => { subscribers.delete(setCombos) }
  }, [])

  return combos
}

/**
 * combo code (e.g. "combo_D") -> human-readable name (e.g. "CTO / VP Engineering").
 *
 * History and Leads both used to render the raw code (FUNC-F1) since neither
 * fetched the combos catalogue that already exists for New Run's picker.
 *
 * The name now comes from the `searchCombo` messages, keyed by the code, so it
 * follows the user's locale — the DB only stores English. `scraper_combos_master`
 * is still the source of truth for WHICH combos exist and for their keywords;
 * i18n only supplies the display copy.
 *
 * The DB `name` is the fallback for a combo with no translation, which is the
 * case for anything added to the table after this shipped. That fallback is the
 * reason for `t.has()` rather than a bare `t()`: a missing key would otherwise
 * render the key path itself ("searchCombo.combo_K.name") in the UI.
 *
 * A combo deactivated org-wide disappears from `/api/scraper-combos` entirely,
 * so callers still need their own fallback to the raw code for historical rows
 * that reference it.
 */
export function useComboLabels(): Record<string, string> {
  const combos = useCombos()
  const t = useTranslations('searchCombo')

  return useMemo(() => {
    const out: Record<string, string> = {}
    for (const c of combos) {
      out[c.code] = t.has(`${c.code}.name`) ? t(`${c.code}.name`) : c.name
    }
    return out
  }, [combos, t])
}

/**
 * Same resolution as `useComboLabels`, plus the description — for the two
 * surfaces that show combos as pickable cards (New Run, Settings) rather than
 * as a one-line label on a lead.
 *
 * Returned in catalogue order (`position`), matching what the API sends, so the
 * picker's layout doesn't shuffle between locales.
 */
export function useComboMeta(): Array<{ code: string; name: string; description: string }> {
  const combos = useCombos()
  const t = useTranslations('searchCombo')

  return useMemo(() => combos.map(c => ({
    code: c.code,
    name: t.has(`${c.code}.name`) ? t(`${c.code}.name`) : c.name,
    description: t.has(`${c.code}.description`)
      ? t(`${c.code}.description`)
      : (c.description ?? ''),
  })), [combos, t])
}
