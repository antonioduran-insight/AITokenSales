import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Core "push a Bridge run's confirmed candidates onto an SDR's kanban board"
 * logic — the Bridge counterpart of `assignRunLeads()` (`./run-assign.ts`).
 *
 * WHY THIS EXISTS: the handoff from the scraper backend to `prospects` is
 * deliberately owned by the CRM, not the Python backend — `prospects` has
 * CRM-owned NOT NULL columns (`area_id` above all) the backend has no value
 * for, so it explicitly declines to insert there. That ownership was only ever
 * implemented for the main scraper (`assignRunLeads`); Bridge shipped without
 * it, so candidates were confirmed, assigned and given generated messages and
 * then silently died in `bridge_candidates` — the SDR never saw a single row.
 *
 * `bridge_candidates` lives in the SAME Supabase project as `prospects`, so the
 * admin client reads it directly; nothing about this goes back through the
 * backend.
 *
 * Called from one place today: the `POST /bridge/candidates/confirm-batch`
 * branch of `src/app/api/bridge/[...path]/route.ts`, after the backend returns
 * 2xx. Keep it the single source of truth — do not reimplement it inline in a
 * route handler.
 *
 * WHERE `area_id` COMES FROM: `users.area_id` of the assigned SDR. Bridge has
 * no region/market of its own (a seed list targets companies, not a country
 * funnel), so unlike a scraper run there is no `runs.region` to prefer and
 * nothing to infer a region from. The recipient's own area is the only
 * defensible semantics, and it is exactly what CSV import already does
 * (`src/app/api/import/route.ts` — reads the area off the assignee's user row
 * and rejects the rows outright when it's missing). An SDR with no area is an
 * error here too, never an invented/nulled area.
 */

export interface AssignBridgeParams {
  admin: SupabaseClient
  /** Candidate ids the client asked to confirm. Re-read from the DB, not trusted. */
  candidateIds: string[]
  /** Already verified to belong to `organizationId` by the caller. */
  sdrId: string
  organizationId: string
}

export type AssignBridgeResult =
  | {
      ok: true
      /** Rows that actually landed in `prospects`. */
      assigned: number
      /** Rows built and attempted (before duplicate-key losses). */
      queued: number
      /** Already on this SDR's board (dedup or 23505). */
      skipped: number
      /** Dropped because `full_name` was empty — `prospects.name` is NOT NULL. */
      skippedNoName: number
    }
  | { ok: false; status: number; error: string }

/** Postgres duplicate-key, however Supabase phrases it. */
const isDuplicateErr = (msg: string) => /duplicate key|unique constraint/i.test(msg)

/** `.in()` goes into the query string — chunk it so long batches can't blow the URL. */
const IN_CHUNK = 200

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

export async function assignBridgeCandidates({
  admin, candidateIds, sdrId, organizationId,
}: AssignBridgeParams): Promise<AssignBridgeResult> {
  const ids = [...new Set(candidateIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) {
    return { ok: false, status: 400, error: 'No candidates to assign' }
  }

  // --- Who receives them, and into which area. ---
  const { data: sdrRow, error: sdrErr } = await admin
    .from('users')
    .select('id, area_id')
    .eq('id', sdrId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (sdrErr) return { ok: false, status: 500, error: sdrErr.message }
  if (!sdrRow) return { ok: false, status: 400, error: 'SDR not found in this organization' }

  const sdrAreaId = (sdrRow as { area_id: string | null }).area_id ?? null
  if (!sdrAreaId) {
    // Never fall back to "some area" — a prospect in the wrong area is visible
    // to the wrong SDRs, and `prospects.area_id` is NOT NULL anyway.
    return {
      ok: false,
      status: 400,
      error: 'The selected SDR has no area set — set it in Settings → Users before confirming Bridge candidates.',
    }
  }

  // --- Re-read the candidates from the DB. ---
  // Same rule the proxy already applies to a run's id: never trust the shape or
  // the contents of what the backend echoed back. We take only rows that are in
  // THIS org and actually reached `confirmed`.
  type CandidateRow = Record<string, unknown>
  const candidates: CandidateRow[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from('bridge_candidates')
      .select('*')
      .in('id', ids.slice(i, i + IN_CHUNK))
      .eq('organization_id', organizationId)
      .eq('verification_status', 'confirmed')
    if (error) return { ok: false, status: 500, error: error.message }
    if (data) candidates.push(...(data as CandidateRow[]))
  }

  if (candidates.length === 0) {
    return { ok: false, status: 400, error: 'No confirmed candidates found for this organization' }
  }

  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t === '' ? null : t
  }
  // The backend returns `company_name` and `company` with the same value on the
  // API side; which one is persisted on the table isn't guaranteed, so read
  // `company_name` first and fall back rather than writing a null company.
  const companyOf = (c: CandidateRow) => str(c.company_name) ?? str(c.company)

  // --- Idempotency. ---
  // `bridge_candidates` has NO `exported_to_crm` column and we can't add one —
  // that table belongs to the backend. So the "did this already land?" question
  // is answered entirely from the CRM side, by looking at `prospects`.
  //
  // Two cases, because the unique index is PARTIAL
  // (`prospects_linkedin_assignee_unique` on (organization_id, linkedin_url,
  // assigned_to) WHERE linkedin_url IS NOT NULL — see
  // supabase/migrations/20260720_prospects_linkedin_per_sdr.sql):
  //
  //  1. WITH a linkedin_url — the DB backs us up. Pre-filter here to keep the
  //     happy path clean, and tolerate 23505 row-by-row below for races.
  //  2. WITHOUT a linkedin_url — the index does not cover these rows at all, so
  //     the DB would happily insert a fresh copy on every retry. We fall back to
  //     a (lowercased name || lowercased company) match against this SDR's
  //     existing prospects.
  //     KNOWN LIMITATION of that fallback, accepted deliberately: it is a
  //     heuristic, not a constraint. Two genuinely different people with the
  //     same name at the same company, assigned to the same SDR, collapse into
  //     one — and conversely, renaming a prospect in the CRM (or the backend
  //     re-scraping a slightly different name/company spelling) lets a retry
  //     insert a second copy. There is no way to do better without either a
  //     column on the backend's table or a new unique index covering
  //     null-URL rows, both of which are out of scope here.
  const urlKeys = new Set<string>()
  const nameCompanyKeys = new Set<string>()

  const candidateUrls = [...new Set(candidates.map(c => str(c.linkedin_url)).filter((u): u is string => !!u))]
  const candidateNames = [...new Set(candidates.map(c => str(c.full_name)).filter((n): n is string => !!n))]

  for (let i = 0; i < candidateUrls.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from('prospects')
      .select('linkedin_url')
      .eq('organization_id', organizationId)
      .eq('assigned_to', sdrId)
      .in('linkedin_url', candidateUrls.slice(i, i + IN_CHUNK))
    if (error) return { ok: false, status: 500, error: error.message }
    for (const p of (data ?? []) as { linkedin_url: string | null }[]) {
      if (p.linkedin_url) urlKeys.add(norm(p.linkedin_url))
    }
  }

  // Only needed if at least one candidate actually lacks a URL.
  const hasUrllessCandidate = candidates.some(c => !str(c.linkedin_url))
  if (hasUrllessCandidate && candidateNames.length > 0) {
    for (let i = 0; i < candidateNames.length; i += IN_CHUNK) {
      const { data, error } = await admin
        .from('prospects')
        .select('name, company')
        .eq('organization_id', organizationId)
        .eq('assigned_to', sdrId)
        .in('name', candidateNames.slice(i, i + IN_CHUNK))
      if (error) return { ok: false, status: 500, error: error.message }
      for (const p of (data ?? []) as { name: string | null; company: string | null }[]) {
        nameCompanyKeys.add(`${norm(p.name)}||${norm(p.company)}`)
      }
    }
  }

  // --- Build the rows. ---
  const prospectRows: Record<string, unknown>[] = []
  let skipped = 0
  let skippedNoName = 0

  for (const c of candidates) {
    const name = str(c.full_name)
    // `bridge_candidates.full_name` is nullable; `prospects.name` is NOT NULL.
    // Deliberately NOT run through `cleanScrapedName()` — that pass exists for
    // the scraper's "Name - Job Title" artefact and there is no evidence Bridge
    // produces it; silently truncating at a dash is the worse failure.
    if (!name) { skippedNoName++; continue }

    const linkedinUrl = str(c.linkedin_url)
    const company = companyOf(c)

    if (linkedinUrl) {
      const key = norm(linkedinUrl)
      if (urlKeys.has(key)) { skipped++; continue }
      urlKeys.add(key) // also guards against duplicates inside this same batch
    } else {
      const key = `${norm(name)}||${norm(company)}`
      if (nameCompanyKeys.has(key)) { skipped++; continue }
      nameCompanyKeys.add(key)
    }

    prospectRows.push({
      name,
      linkedin_url: linkedinUrl,
      company,
      title: str(c.title),
      custom1: str(c.custom1),
      custom2: str(c.custom2),
      // Bridge has no market concept — a seed list targets companies, and the
      // candidate's `location` is a free-text city, not one of the org's
      // `markets` rows. Writing it into `market` would corrupt every
      // market-filtered view, so it stays null.
      market: null,
      // `source` is typed as 'manual' | 'csv_import' in types.ts, which is
      // already stale (the scraper writes 'scraper' and it works). Whether the
      // column has a CHECK constraint could not be confirmed from this repo —
      // there is no migration that creates `prospects` here — so 'bridge' is
      // NOT used: an unknown-value rejection would fail the whole handoff again.
      // Reusing the scraper's value is the safe choice until the constraint is
      // verified and, if needed, widened by a migration.
      // Caveat to keep in mind: `assignRunLeads()` manual mode ("Send to another
      // SDR") deletes prospects by (org, source='scraper', linkedin_url) — a
      // Bridge prospect sharing a linkedin_url with a scraper lead in the same
      // run would be caught by that sweep. Vanishingly unlikely (partnership
      // contacts vs. ICP leads), but it's the price of the shared value.
      source: 'scraper',
      outreach_status: 'new',
      lead_temperature: 'Cold',
      area_id: sdrAreaId,
      assigned_to: sdrId,
      organization_id: organizationId,
      flag_tomorrow: false,
    })
  }

  // --- Insert, batched, with a row-by-row fallback on duplicate keys. ---
  // Same shape as `assignRunLeads()`: one conflicting row must never abort the
  // whole handoff.
  let inserted = 0
  for (let i = 0; i < prospectRows.length; i += 100) {
    const batch = prospectRows.slice(i, i + 100)
    const { data, error } = await admin.from('prospects').insert(batch).select('id')
    if (!error) { inserted += data?.length ?? 0; continue }
    if (!isDuplicateErr(error.message)) {
      return { ok: false, status: 500, error: error.message }
    }
    for (const row of batch) {
      const { data: one, error: rowErr } = await admin.from('prospects').insert(row).select('id')
      if (!rowErr) { inserted += one?.length ?? 0 }
      else if (!isDuplicateErr(rowErr.message)) {
        return { ok: false, status: 500, error: rowErr.message }
      } else { skipped++ }
    }
  }

  // NO `monthly_lead_counts` bump, on purpose. The quota that actually gates
  // runs (`getLeadQuota()` in ./lead-quota.ts) counts `scraper_leads` with
  // exported_to_crm = true — Bridge candidates are not scraper_leads and never
  // will be, so they consume no quota. Bumping the monthly counter here would
  // make the dashboard's "leads this month" and the enforced quota disagree by
  // exactly the Bridge volume, with nothing to reconcile them. If Bridge should
  // consume quota, that's a deliberate product decision that has to change
  // `getLeadQuota()` too — not a side effect of this function.

  return { ok: true, assigned: inserted, queued: prospectRows.length, skipped, skippedNoName }
}
