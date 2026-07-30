#!/usr/bin/env node
/**
 * Regenerates src/lib/industry-codes.ts from HarvestAPI's published LinkedIn
 * industry code list.
 *
 * WHY THIS EXISTS
 * The Bridge seed-list form has always had an Industry field that accepted
 * free text and then threw it away: the proxy sent `industry_codes: []`
 * because no name -> code mapping existed anywhere in the project. Worse, the
 * field counted as a valid criterion, so a seed list whose ONLY filter was an
 * industry saved happily and then searched with no filter at all.
 *
 * The actor takes numeric LinkedIn industry ids, and HarvestAPI publishes the
 * full list. Generating from that source rather than hand-typing 434 rows
 * means the mapping is theirs, not our transcription of it, and re-running
 * this picks up any change.
 *
 * USAGE
 *   node scripts/generate-industry-codes.mjs
 *
 * Run it again if the actor's docs point at a newer file. The output is
 * committed, so the app never fetches this at runtime.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Referenced by the `industryIds` field description of both HarvestAPI actors.
const SOURCE =
  'https://raw.githubusercontent.com/HarvestAPI/linkedin-industry-codes-v2/main/linkedin_industry_code_v2_all_eng_with_header.csv'

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/industry-codes.ts'
)

/** Minimal CSV line parser — the labels contain commas inside quotes
 *  ("Bars, Taverns, and Nightclubs"), so splitting on ',' is not enough. */
function parseLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ }
      else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const res = await fetch(SOURCE)
if (!res.ok) {
  console.error(`Could not fetch the industry list: ${res.status} ${res.statusText}`)
  process.exit(1)
}

const rows = (await res.text())
  .trim()
  .split('\n')
  .slice(1) // header: id,label,hierarchy,description
  .map(parseLine)
  .filter(r => r.length >= 3 && r[0] && r[1])
  .map(r => ({
    id: Number(r[0]),
    label: r[1],
    // "A > B > C" — the root is the coarse category the picker groups by.
    group: (r[2] || '').split(' > ')[0] || r[1],
  }))
  .filter(r => Number.isFinite(r.id))

if (rows.length < 100) {
  console.error(`Only parsed ${rows.length} rows — the source format probably changed. Not writing.`)
  process.exit(1)
}

const body = rows
  .map(r => `  [${r.id}, ${JSON.stringify(r.label)}, ${JSON.stringify(r.group)}],`)
  .join('\n')

const file = `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/generate-industry-codes.mjs\` to regenerate.
// Source: ${SOURCE}
//
// LinkedIn industry ids accepted by HarvestAPI's \`industryIds\` filter, with
// the coarse category each belongs to so the picker can group ${rows.length}
// options into something navigable.

export type IndustryCode = { id: number; label: string; group: string }

const RAW: Array<[number, string, string]> = [
${body}
]

export const INDUSTRY_CODES: IndustryCode[] = RAW.map(([id, label, group]) => ({ id, label, group }))

export const INDUSTRY_BY_ID = new Map<number, IndustryCode>(
  INDUSTRY_CODES.map(i => [i.id, i])
)

/** Coarse categories, in the order they first appear in LinkedIn's own list. */
export const INDUSTRY_GROUPS: string[] = [...new Set(INDUSTRY_CODES.map(i => i.group))]

/** Case-insensitive substring match over labels, for the picker's search box. */
export function searchIndustries(query: string, limit = 50): IndustryCode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: IndustryCode[] = []
  for (const item of INDUSTRY_CODES) {
    if (item.label.toLowerCase().includes(q)) {
      out.push(item)
      if (out.length >= limit) break
    }
  }
  return out
}
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, file, 'utf8')
console.log(`Wrote ${rows.length} industries to ${OUT}`)
