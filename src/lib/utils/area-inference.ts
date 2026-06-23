import type { AreaName } from '@/lib/types'

// Maps country/market strings from CSV to AreaName
// Southeast Asia (except Vietnam) → taiwan (that's the market coverage)
const countryToArea: Record<string, AreaName> = {
  // Taiwan
  'taiwan': 'taiwan', 'tw': 'taiwan', '台灣': 'taiwan', '台湾': 'taiwan',

  // Southeast Asia → taiwan market
  'thailand': 'taiwan', 'thai': 'taiwan', 'th': 'taiwan',
  'indonesia': 'taiwan', 'id': 'taiwan',
  'malaysia': 'taiwan', 'my': 'taiwan',
  'singapore': 'taiwan', 'sg': 'taiwan',
  'philippines': 'taiwan', 'ph': 'taiwan',
  'myanmar': 'taiwan', 'mm': 'taiwan',
  'cambodia': 'taiwan', 'kh': 'taiwan',
  'laos': 'taiwan', 'la': 'taiwan',
  'brunei': 'taiwan', 'bn': 'taiwan',
  'timor-leste': 'taiwan', 'tl': 'taiwan',
  'east timor': 'taiwan',
  'sea': 'taiwan',         // common abbreviation "SEA"
  'southeast asia': 'taiwan',
  'south east asia': 'taiwan',
  'asia': 'taiwan',        // generic "Asia" defaults to taiwan

  // Vietnam
  'vietnam': 'vietnam', 'viet nam': 'vietnam', 'vn': 'vietnam',
  'việt nam': 'vietnam', 'ho chi minh': 'vietnam', 'hanoi': 'vietnam',

  // LATAM
  'argentina': 'latam', 'ar': 'latam',
  'mexico': 'latam', 'méxico': 'latam', 'mx': 'latam',
  'uruguay': 'latam', 'uy': 'latam',
  'chile': 'latam', 'cl': 'latam',
  'colombia': 'latam', 'co': 'latam',
  'peru': 'latam', 'perú': 'latam', 'pe': 'latam',
  'brazil': 'latam', 'brasil': 'latam', 'br': 'latam',
  'venezuela': 'latam', 've': 'latam',
  'ecuador': 'latam', 'ec': 'latam',
  'bolivia': 'latam', 'bo': 'latam',
  'paraguay': 'latam', 'py': 'latam',
  'costa rica': 'latam', 'cr': 'latam',
  'panama': 'latam', 'panamá': 'latam', 'pa': 'latam',
  'guatemala': 'latam', 'gt': 'latam',
  'honduras': 'latam', 'hn': 'latam',
  'el salvador': 'latam', 'sv': 'latam',
  'nicaragua': 'latam', 'ni': 'latam',
  'cuba': 'latam', 'cu': 'latam',
  'dominican republic': 'latam', 'do': 'latam',
  'puerto rico': 'latam', 'pr': 'latam',
  'latam': 'latam', 'latin america': 'latam', 'latin': 'latam',

  // Europe
  'spain': 'europe', 'españa': 'europe', 'es': 'europe',
  'france': 'europe', 'fr': 'europe',
  'germany': 'europe', 'de': 'europe',
  'italy': 'europe', 'italia': 'europe', 'it': 'europe',
  'portugal': 'europe', 'pt': 'europe',
  'netherlands': 'europe', 'nl': 'europe', 'holland': 'europe',
  'uk': 'europe', 'united kingdom': 'europe', 'gb': 'europe', 'england': 'europe',
  'switzerland': 'europe', 'ch': 'europe',
  'austria': 'europe', 'at': 'europe',
  'belgium': 'europe', 'be': 'europe',
  'sweden': 'europe', 'se': 'europe',
  'norway': 'europe', 'no': 'europe',
  'denmark': 'europe', 'dk': 'europe',
  'finland': 'europe', 'fi': 'europe',
  'poland': 'europe', 'pl': 'europe',
  'czechia': 'europe', 'czech republic': 'europe', 'cz': 'europe',
  'romania': 'europe', 'ro': 'europe',
  'hungary': 'europe', 'hu': 'europe',
  'greece': 'europe', 'gr': 'europe',
  'ireland': 'europe', 'ie': 'europe',
  'eu': 'europe', 'europe': 'europe', 'europa': 'europe',
}

export function inferAreaFromCountry(country: string): AreaName | null {
  if (!country?.trim()) return null
  return countryToArea[country.toLowerCase().trim()] ?? null
}

// Try to infer area from multiple fields of a mapped CSV row
export function inferAreaFromRow(mapped: Record<string, string>): AreaName | null {
  // Priority: market > company (last resort hints only) — in order
  const candidates = [
    mapped.market,
    // could add more heuristics here later
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const result = inferAreaFromCountry(candidate)
    if (result) return result
  }
  return null
}

export const AREA_LABELS: Record<AreaName, string> = {
  taiwan: 'Taiwan / SEA',
  latam: 'LATAM',
  vietnam: 'Vietnam',
  europe: 'Europe',
}
