import type { AreaName, Market } from '@/lib/types'
import { AREA_NAMES } from '@/lib/types'

/**
 * Area resolution is driven by the `markets` table, not by a hardcoded country
 * list: `markets.region` uses the same vocabulary as `areas.name`, so a
 * market's region IS its area.
 *
 * The lookup stays synchronous — callers load the market catalogue once (they
 * already do, for the market picker) and build the map with
 * `buildMarketAreaMap()`. Querying per call would mean one round-trip per row
 * in list views.
 */

/** Lowercased market name → region. */
export type MarketAreaMap = Record<string, AreaName>

const AREA_SET = new Set<string>(AREA_NAMES)

/**
 * Coerce a raw region value to an AreaName.
 * Tolerates casing and separator drift from the backend
 * ("Latin America", "LATIN_AMERICA", "latin-america" → "latin_america").
 */
export function normalizeAreaName(raw: string | null | undefined): AreaName | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return AREA_SET.has(key) ? (key as AreaName) : null
}

/** Build the market-name → area lookup from the markets catalogue. */
export function buildMarketAreaMap(markets: Market[]): MarketAreaMap {
  const map: MarketAreaMap = {}
  for (const m of markets) {
    const area = normalizeAreaName(m.region)
    if (area && m.name) map[m.name.trim().toLowerCase()] = area
  }
  return map
}

/**
 * Resolve the area a market belongs to.
 * Returns null for an unknown market, which callers treat as "no filter"
 * (show every SDR) rather than "no matches".
 */
export function inferAreaFromCountry(
  marketName: string | null | undefined,
  map: MarketAreaMap
): AreaName | null {
  if (!marketName?.trim()) return null
  return map[marketName.trim().toLowerCase()] ?? null
}

export const AREA_LABELS: Record<AreaName, string> = {
  asia: 'Asia',
  latin_america: 'Latin America',
  europe: 'Europe',
  usa: 'USA',
}

/** Label for a raw region/area value, falling back to the raw string. */
export function areaLabel(raw: string | null | undefined): string {
  const area = normalizeAreaName(raw)
  return area ? AREA_LABELS[area] : (raw ?? '—')
}
