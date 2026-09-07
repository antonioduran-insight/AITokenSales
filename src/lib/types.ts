export type OutreachStatus =
  | 'new'
  | 'connection_sent'
  | 'connected'
  | 'replied'
  | 'demo_scheduled'
  | 'closed'
  | 'nurture'

export type LeadTemperature = 'Cold' | 'Warm' | 'Hot'

/**
 * The opaque combo code stored in `prospects.search_combo` — the same
 * vocabulary as `scraper_combos_master.code` and `runs.combos`. Always resolve
 * it to a human label with `useComboLabels()` rather than rendering the code.
 *
 * This was a union of `combo_A`..`combo_F`, mirroring a DB CHECK with the same
 * list. Both were wrong and both are gone:
 *
 *  - The catalogue never had a `combo_F`. It seeds A, B, C, D, E and **G**, so
 *    the CHECK rejected every lead combo_G found, and `assignRunLeads()` —
 *    which only tolerates duplicate-key errors row by row — aborted the whole
 *    run's assignment with a 500 rather than skipping one lead.
 *  - Since `20260904_org_owned_combos.sql` an organization can define its own
 *    combos, whose codes are minted as `custom_<12 hex>`. No fixed union can
 *    describe those.
 *
 * So the type is a bare string on purpose: the set of valid codes lives in the
 * database, per organization, not in this file. Use `normalizeSearchCombo()`
 * for anything arriving from a CSV or a human.
 */
export type SearchCombo = string

export type UserRole = 'admin_global' | 'admin' | 'sdr' | 'support'

/**
 * The four geographic regions. Shared vocabulary: `areas.name` (how SDRs are
 * classified) and `markets.region` (how the ~49 countries are grouped) both use
 * exactly these values, so a market's region IS an area.
 */
export type AreaName = 'asia' | 'latin_america' | 'europe' | 'usa'

export type AuditEventType =
  | 'prospect_created'
  | 'prospect_updated'
  | 'status_changed'
  | 'prospect_reassigned'
  | 'note_added'
  | 'conversation_added'
  | 'duplicate_attempt'
  | 'sdr_created'
  | 'sdr_deactivated'
  | 'csv_import'

export interface Area {
  id: string
  name: AreaName
  label_zh: string
  label_en: string
  label_vi: string
  label_es: string
  is_active: boolean
  created_at: string
}

export interface User {
  id: string
  full_name: string
  email: string
  role: UserRole
  area_id: string | null
  organization_id: string | null
  /** Which site (branch office) this person belongs to. `null` means org-wide:
   *  they see every workspace, which is how the customer's head-office admin
   *  is expressed — there is no separate role for it. Every user is null until
   *  someone is explicitly assigned, so this stays inert for single-site orgs.
   *  See {@link Workspace}. */
  workspace_id: string | null
  is_active: boolean
  /** @deprecated SDRs never have scraper access — only the org admin runs the
   *  scraper. The column still exists in the DB but nothing reads it. */
  scraper_access?: boolean
  created_at: string
  years_experience?: number | null
  seniority?: string | null
  expertise_area?: string | null
  // Joined
  area?: Area
}

export interface Prospect {
  id: string
  // Scraping / pipeline fields
  name: string
  linkedin_url: string | null
  email: string | null
  company: string | null
  title: string | null
  industry: string | null
  company_size: string | null
  icp_score: number | null
  lead_temperature: LeadTemperature | null
  search_combo: SearchCombo | null
  scrape_date: string | null
  custom1: string | null
  custom2: string | null
  custom3: string | null
  // Cached translation of custom1/custom2 — one language "slot" per field,
  // overwritten by the next translate call. Kept alongside the original so
  // the drawer can toggle between them without re-calling the API.
  custom1_translation: string | null
  custom1_translation_lang: string | null
  custom2_translation: string | null
  custom2_translation_lang: string | null
  // CRM fields
  outreach_status: OutreachStatus
  market: string | null
  area_id: string
  /** The site this lead belongs to. Independent of `market`/`area_id` — two
   *  sites can work the same territory. Inherited from the SDR it is assigned
   *  to; null for leads that predate any site assignment. See {@link Workspace}. */
  workspace_id: string | null
  /** When the lead was archived, or null while it is active.
   *
   *  Archiving hides a lead from Kanban and the Leads table WITHOUT deleting
   *  it and WITHOUT refunding it against the monthly quota — quota counts
   *  `scraper_leads`, never prospects. Deduplication deliberately ignores this
   *  field: an archived lead that stopped counting as a duplicate would be
   *  re-imported and reappear. */
  archived_at: string | null
  archived_by: string | null
  assigned_to: string | null
  flag_tomorrow: boolean
  // Kept in sync with the CHECK constraint on prospects.source. This type had
  // drifted: it listed only two values while the scraper had been writing
  // 'scraper' for months, which is why nobody trusted it when deciding whether
  // 'bridge' was safe to insert.
  source: 'manual' | 'csv_import' | 'scraper' | 'bridge'
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  area?: Area
  assigned_user?: User
}

export interface Note {
  id: string
  prospect_id: string
  author_id: string
  content: string
  created_at: string
  author?: User
}

export interface Conversation {
  id: string
  prospect_id: string
  author_id: string
  chat_content: string
  reason: string
  created_at: string
  // Joined
  author?: User
  prospect?: Pick<Prospect, 'id' | 'name' | 'company' | 'title' | 'outreach_status' | 'lead_temperature' | 'area_id' | 'assigned_to' | 'linkedin_url' | 'email' | 'icp_score' | 'custom1' | 'custom2' | 'custom3' | 'source' | 'created_at' | 'updated_at' | 'market' | 'search_combo' | 'scrape_date' | 'industry' | 'company_size' | 'flag_tomorrow' | 'created_by'> & { area?: Area; assigned_user?: User }
}

export interface AuditLog {
  id: string
  actor_id: string
  actor_name: string
  event_type: AuditEventType
  prospect_id: string | null
  prospect_name: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface CSVImportSession {
  id: string
  imported_by: string | null
  total_rows: number
  imported: number
  skipped: number
  forced_duplicates: number
  area_id: string | null
  created_at: string
}

export type Locale = 'zh' | 'en' | 'vi' | 'es'

export const OUTREACH_STATUSES: OutreachStatus[] = [
  'new',
  'connection_sent',
  'connected',
  'replied',
  'demo_scheduled',
  'closed',
  'nurture',
]

export const LEAD_TEMPERATURES: LeadTemperature[] = ['Cold', 'Warm', 'Hot']

// `SEARCH_COMBOS` used to sit here as a hardcoded list of combo codes. It is
// gone rather than updated: it had no readers, it listed a `combo_F` that has
// never existed, and per-org combos make any static list wrong by construction.
// The live catalogue is `GET /api/scraper-combos` (global rows + the caller's
// own), surfaced to components through `useComboLabels()` / `useComboMeta()`.

/**
 * Tolerant parser for a `search_combo` coming from a CSV or a human.
 *
 * Accepts three shapes:
 *  - a catalogue letter code, however it was typed: `combo_D`, `combo_d`,
 *    `Combo D`, `COMBO-D`, `D`, `d` — all normalise to `combo_D`. The letter
 *    range is A-Z, not A-F: the seeded catalogue includes `combo_G`, and the
 *    old A-F test silently dropped it on every import.
 *  - a custom combo code (`custom_<hex>`), which is what an organization's own
 *    combos are minted as. Lower-cased, since the code is stored lower-case.
 *  - anything else -> `null` (the column is nullable).
 *
 * Deliberately still a whitelist and not a passthrough. The DB CHECK that used
 * to catch junk is gone (see {@link SearchCombo}), so this function is now the
 * only thing standing between a mis-mapped CSV column and a `search_combo`
 * holding a person's job title.
 *
 * Lives here, not in the wizard, because the CSV wizard (client) and
 * `PUT /api/import` (server) must agree on it exactly, and a route handler must
 * not import from a `'use client'` component.
 */
export function normalizeSearchCombo(value: unknown): SearchCombo | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (/^custom_[0-9a-fA-F]{6,32}$/.test(raw)) return raw.toLowerCase()
  const letter = raw.toUpperCase().replace(/^COMBO[\s_-]*/, '')
  if (!/^[A-Z]$/.test(letter)) return null
  return `combo_${letter}`
}

/**
 * The seniority labels the Apify actor accepts, verbatim.
 *
 * Not a style choice and not extensible: the actor validates this field against
 * its own enum and rejects the ENTIRE input — failing the whole run — on a
 * value it doesn't recognise. The backend defends itself
 * (`_normalize_seniority_levels` maps a few high-confidence aliases and drops
 * the rest with a log line), but a dropped value is a filter the customer
 * thought they had set and silently didn't, so the combo editor offers exactly
 * these and the API rejects anything else.
 *
 * Mirrors `ALLOWED_SENIORITY_LEVELS` in `scraper/apify_scraper.py`. If LinkedIn
 * ever changes the vocabulary, both move together.
 */
export const SENIORITY_LEVELS = [
  'Owner/Partner',
  'CXO',
  'Vice President',
  'Director',
  'Experienced Manager',
  'Entry Level Manager',
  'Strategic',
  'Senior',
  'Entry Level',
  'In Training',
] as const

/**
 * The company-size buckets the actor accepts, verbatim — same contract as
 * {@link SENIORITY_LEVELS}, mirroring `ALLOWED_COMPANY_HEADCOUNTS`.
 *
 * The seeded global combos store LinkedIn's letter codes (`'B'`, `'C'`) instead;
 * the backend maps those through `COMPANY_HEADCOUNT_CODE_MAP`. New combos are
 * written with these labels directly — there is no reason to make a customer
 * pick a letter whose meaning is documented in a Python dict.
 */
export const COMPANY_HEADCOUNTS = [
  'Self-employed',
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5001-10000',
  '10001+',
] as const

/**
 * Hard cap on a combo's `title_keywords`, enforced when a custom combo is
 * saved. The incumbent actor rejects an input with more than 20 and HarvestAPI
 * caps at 50; the backend truncates to whichever applies at run time, so this
 * is only here to stop someone pasting a thousand titles into the form.
 */
export const MAX_COMBO_TITLE_KEYWORDS = 50

/** `prospects.icp_score` has a DB CHECK of `icp_score >= 0 AND icp_score <= 100`. */
export const ICP_SCORE_MIN = 0
export const ICP_SCORE_MAX = 100

/**
 * Parses an imported ICP score, returning `null` for anything that isn't a
 * finite number inside 0-100. Deliberately **discards** rather than clamps: a
 * `150` in a CSV means a mis-mapped column or a different scale, and silently
 * rewriting it to `100` would invent a perfect-fit lead. Shared by the wizard
 * and `PUT /api/import` for the same reason as `normalizeSearchCombo`.
 */
export function normalizeIcpScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim())
  if (!Number.isFinite(n)) return null
  if (n < ICP_SCORE_MIN || n > ICP_SCORE_MAX) return null
  return n
}

/** Canonical display order for regions, used by both area and market UIs. */
export const AREA_NAMES: AreaName[] = ['asia', 'latin_america', 'europe', 'usa']

export interface Organization {
  id: string
  name: string
  slug: string
  /** {@link PlanName}, not a second copy of the same union — this field used to
   *  spell the plans out inline, so adding one left `Organization.plan` behind
   *  and every comparison against the new plan became a type error in code that
   *  was correct. */
  plan: PlanName
  is_active: boolean
  logo_url: string | null
  max_seats: number
  max_leads_per_month: number | null
  custom_price: number | null
  vendor: string | null
  internal_notes: string | null
  domain_blacklist: string | null
  /** What the org sells and to whom — fed to the scraper so outreach messages
   *  can reference real products / focus. */
  company_context: string | null
  /** What the org wants out of partnerships — fed to Bridge when generating
   *  messages for confirmed candidates. */
  bridge_context: string | null
  billing_day: number
  apify_token: string | null
  anthropic_key: string | null
  anthropic_base_url: string | null
  anthropic_model: string | null
  created_at: string
  updated_at: string
}

export interface ScraperComboMaster {
  id: string
  /** NULL for the shared global catalogue; the owning org for a custom combo
   *  it defined itself. See `20260904_org_owned_combos.sql`. Only present on
   *  rows read through `GET /api/scraper-combos`. */
  organization_id?: string | null
  code: string
  name: string
  description: string | null
  title_keywords: string[]
  seniority_levels: string[]
  company_headcounts: string[]
  functions: string[]
  is_active: boolean
  position: number
  created_at: string
  org_active?: boolean
}

export interface OrgCombo {
  id: string
  organization_id: string
  combo_code: string
  is_active: boolean
  created_at: string
}

export interface SenderProfile {
  id: string
  user_id: string
  organization_id: string
  display_name: string
  title: string
  company: string
  style_hint: string
  icp_focus: string[]
  /** null = the SDR never touched the language selector; the backend then
   * defers to the market's own language instead of forcing English. */
  language: string | null
  is_default: boolean
  is_active: boolean
  created_at: string
}

export interface RunRecord {
  id: string
  organization_id: string
  executed_by: string | null
  combos: string[]
  market: string
  markets?: string[]
  /** Region picked in New Run Phase 1 (e.g. 'latin_america') — reference/logging only. */
  region?: string | null
  total_leads_requested: number
  sdr_count: number
  plan: string
  status: string
  error_message: string | null
  created_at: string
  updated_at: string
  executor?: { full_name: string }
  run_sdr_assignments?: RunSdrAssignment[]
}

/**
 * A country an organization can target. The catalogue lives in the `markets`
 * table (owned by the scraper backend, ~49 countries); each org activates the
 * subset it cares about via `organization_markets`.
 */
export interface Market {
  id: string
  name: string
  /** One of AreaName. Kept as string so an unexpected backend value still
   *  renders instead of breaking the page. */
  region: string
}

/** Lifecycle of a scraper run, as reported by the Python backend. */
export type RunStatus = 'pending' | 'running' | 'scoring' | 'drafting' | 'completed' | 'failed' | 'cancelled'

/** A raw scraped lead, before it is imported into `prospects`. */
export interface Lead {
  id: string
  run_id: string
  sdr_id?: string
  linkedin_url?: string
  first_name?: string
  last_name?: string
  full_name?: string
  company?: string
  title?: string
  industry?: string
  company_size?: string
  location?: string
  email?: string
  icp_score?: number
  temperature?: 'HOT' | 'WARM' | 'COLD'
  market?: string
  search_combo?: string
  custom1?: string
  custom2?: string
  exported_to_crm: boolean
  created_at: string
}

/** A log line written by the backend while a run executes. */
export interface RunLog {
  id: string
  run_id: string
  level: 'info' | 'warning' | 'error' | 'success'
  message: string
  created_at: string
}

export interface RunSdrAssignment {
  id: string
  run_id: string
  sdr_id: string
  sender_profile_id: string | null
  leads_assigned: number
  assigned_markets?: string[]
  created_at: string
  user?: { full_name: string }
}

export interface OrganizationAddon {
  id: string
  organization_id: string
  /** Refleja el CHECK de `organization_addons.addon_type`, que sigue
   *  permitiendo `account_management` a propósito para que las filas
   *  históricas sigan siendo legibles. Lo que se puede VENDER es
   *  {@link ADDON_LIST}, que es más corto — no uses este tipo para decidir
   *  qué ofrecer. */
  addon_type: 'account_management' | 'multi_workspace' | 'extended_data_retention' | 'sso' | 'linkedin_auto_messaging' | 'bridge'
  is_active: boolean
  price_monthly: number | null
  activated_at: string
}

export interface Vendor {
  id: string
  name: string
  email: string | null
  commission_pct: number
  is_active: boolean
  created_at: string
}

export interface SupportTicket {
  id: string
  organization_id: string
  created_by: string
  subject: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  assigned_to: string | null
  created_at: string
  updated_at: string
  organization?: Organization
}

export interface SupportTicketMessage {
  id: string
  ticket_id: string
  author_id: string
  content: string
  created_at: string
  author?: User
}

export const PLAN_PRICES: Record<string, number> = {
  basic: 550,
  premium: 2300,
  enterprise: 0,
  ultra: 0,
  // A trial is not sold. Zero here AND excluded from the revenue views, the
  // same belt-and-braces `ultra` gets — see isBillablePlan.
  demo: 0,
}

export const MAX_INT = 2147483647

// Hard cap on rows per CSV import — keeps a single PUT /api/import insert
// well within the serverless function's time limit even in the worst case
// (every row hitting the per-record fallback in that route). Enforced both
// in CSVImportWizard.tsx (immediate feedback before column mapping) and in
// the route itself (the frontend check is never the correctness boundary).
export const MAX_IMPORT_ROWS = 500

export const PLAN_DEFAULTS: Record<string, { max_seats: number; max_leads_per_month: number }> = {
  basic:      { max_seats: 3,        max_leads_per_month: 1000 },
  premium:    { max_seats: 7,        max_leads_per_month: 3000 },
  enterprise: { max_seats: 15,       max_leads_per_month: 10000 },
  ultra:      { max_seats: MAX_INT,  max_leads_per_month: MAX_INT },
  // Only a starting point. The whole purpose of `demo` is that Global Admin
  // then sets these to whatever this particular prospect should get — the
  // numbers were always per-org editable, so the plan just picks where the
  // form starts.
  demo:       { max_seats: 3,        max_leads_per_month: 200 },
}

export type PlanName = 'basic' | 'premium' | 'enterprise' | 'ultra' | 'demo'

const ALL_PLANS: PlanName[] = ['basic', 'premium', 'enterprise', 'ultra', 'demo']

/**
 * Plans that see every feature regardless of tier.
 *
 * `ultra` is Insight Software's own internal plan. `demo` is a prospect being
 * shown the product, and a demo that hides half of it is not a demo — so the
 * trial deliberately behaves like the top tier while its NUMBERS (seats, leads)
 * stay whatever Global Admin set, which is usually small.
 *
 * This exists as one exported predicate because tier gating was previously an
 * inline plan list repeated in each gate. Adding a plan then meant finding all
 * of them, and missing one fails silently in the worst direction: a prospect
 * being sold the product hits a padlock in the middle of a demo.
 *
 * The sales consequence is worth stating out loud: a demo shows features that
 * Basic and Premium do not include, so whoever runs it has to say which plan
 * each one lands on. That was the accepted trade when this was chosen.
 */
export function planHasFullAccess(plan: string | null | undefined): boolean {
  return plan === 'ultra' || plan === 'demo'
}

/**
 * Whether this plan's organization counts as revenue.
 *
 * `ultra` is internal and `demo` is unpaid; neither belongs in MRR, the quarter
 * breakdown, or a vendor's commission. Mirrors the `plan === 'ultra'` skips
 * that already existed in both revenue views, so those two never drift apart
 * again.
 */
export function isBillablePlan(plan: string | null | undefined): boolean {
  return !!plan && plan !== 'ultra' && plan !== 'demo'
}

/**
 * The add-on catalogue — what can actually be sold.
 *
 * `plans`      — plans on which the add-on can be SOLD.
 * `includedIn` — plans that already bundle it, so selling it again would
 *                double-charge for something the customer has.
 *
 * Both come from the product brief (Aug 2026). `ultra` is in every list
 * because it is Insight Software's own internal plan, deliberately without
 * limits; it is never invoiced, so eligibility rules would only get in the way.
 *
 * Before this existed, Global Admin let any add-on be ticked on any plan —
 * a Premium org could be charged for something its plan already included, and
 * Multi-workspace (Enterprise-only) could be sold to a Basic account.
 *
 * RETIRED, and deliberately absent rather than commented out:
 *
 *   `account_management` ($149/mo in the brief, 帳號代管服務) — dropped
 *   05/08/2026, it is not being offered. Removing it from this list is what
 *   takes it out of Global Admin, Settings and Revenue Reports at once; the
 *   `addon_type` CHECK on `organization_addons` still permits the value, on
 *   purpose, so any historical row stays readable instead of the constraint
 *   rejecting its own data. Nothing can create a new one.
 */
export const ADDON_LIST = [
  {
    type: 'multi_workspace', labelKey: 'addOn_multi_workspace', price: '$300/mo per site',
    // Brief: "僅 Enterprise". Priced per site; the main one comes with the
    // plan, so Revenue Reports charges (active sites − 1).
    // `demo` is on every add-on list on purpose: a trial has to be able to
    // show whatever this prospect is being sold, including the Enterprise-only
    // pieces. It is never invoiced (see isBillablePlan).
    plans: ['enterprise', 'ultra', 'demo'] as PlanName[],
    includedIn: [] as PlanName[],
  },
  {
    type: 'extended_data_retention', labelKey: 'addOn_extended_data_retention', price: '$99/mo',
    plans: ALL_PLANS,
    includedIn: [] as PlanName[],
  },
  {
    // El brief lo llama solo "SSO 單一登入". Precisado 05/08/2026 a SAML
    // empresarial, que es lo único que este add-on entrega: la conexión al IdP
    // del cliente (`sso_provider_id` + `sso_domains` en `organizations`, padrón
    // en `sso_roster`). Ver docs/PLAN-SSO.md.
    //
    // El fee único cubre coordinar el intercambio de metadata con el
    // departamento de IT de cada cliente. Eso es trabajo real y por cliente;
    // el código ya está hecho y no se cobra por instalarlo de nuevo.
    type: 'sso', labelKey: 'addOn_sso', price: '$299 one-time',
    plans: ['premium', 'enterprise', 'ultra', 'demo'] as PlanName[],
    includedIn: [] as PlanName[],
  },
  {
    type: 'linkedin_auto_messaging', labelKey: 'addOn_linkedin_auto_messaging', price: 'TBD',
    plans: ['premium', 'enterprise', 'ultra', 'demo'] as PlanName[],
    includedIn: [] as PlanName[],
  },
  {
    type: 'bridge', labelKey: 'addOn_bridge', price: 'TBD',
    // Bridge postdates the brief and has no stated plan restriction, so it is
    // left open rather than guessed at. Narrow it once it is priced.
    plans: ALL_PLANS,
    includedIn: [] as PlanName[],
  },
] as const

/** Can this add-on be sold on this plan? */
export function isAddonSellable(addonType: string, plan: string): boolean {
  const a = ADDON_LIST.find(x => x.type === addonType)
  if (!a) return false
  return (a.plans as readonly string[]).includes(plan)
}

/** Does the plan already bundle it, making a separate charge a double-charge? */
export function isAddonIncluded(addonType: string, plan: string): boolean {
  const a = ADDON_LIST.find(x => x.type === addonType)
  if (!a) return false
  return (a.includedIn as readonly string[]).includes(plan)
}

// Recurring monthly price per add-on, used by Revenue Reports. One-time / TBD
// add-ons (sso, linkedin_auto_messaging) contribute 0 to the monthly run-rate.
export const ADDON_MONTHLY_PRICE: Record<string, number> = {
  // `account_management` retirado 05/08/2026 — ver ADDON_LIST. Fuera del mapa
  // a propósito: `addonsMonthly()` usa `?? 0`, así que una fila histórica deja
  // de sumar al MRR en vez de seguir facturando algo que ya no se vende.
  /** PER SITE, not per org. The main site comes with the plan, so Revenue
   *  Reports multiplies this by (active sites − 1). See `addonsMonthly()` in
   *  the reports page — reading this constant alone will understate an org
   *  with several branches. */
  multi_workspace: 300,
  extended_data_retention: 99,
  /** 0 because SSO is a ONE-TIME $299 charge, not a subscription — see
   *  ADDON_ONE_TIME_PRICE below and the product brief (Aug 2026).
   *
   *  This was 99 until 05/08/2026, which silently added $99/mo of MRR for
   *  every org with SSO to Revenue Reports. The bug was easy to miss because
   *  `ADDON_LIST` said "$299 one-time" and the comment right above this object
   *  claimed one-time add-ons contributed 0 — three sources, all disagreeing,
   *  and only this one was actually being summed. */
  sso: 0,
  linkedin_auto_messaging: 0,
  bridge: 0, // TBD
}

/**
 * Add-ons billed once at activation rather than every month.
 *
 * Kept separate from ADDON_MONTHLY_PRICE rather than flagged inside it: a
 * single map with a "recurring?" boolean invites exactly the mistake that
 * happened with SSO, where one caller summed a value the shape of a monthly
 * fee that was never monthly. Two maps make the question unaskable — if a
 * price is in here, no monthly total can accidentally include it.
 *
 * Recognised in Revenue Reports through `addon_audit_log.created_at`, so the
 * charge lands in the quarter the add-on was actually switched on.
 */
export const ADDON_ONE_TIME_PRICE: Record<string, number> = {
  sso: 299,
}

/**
 * A site/branch inside one organization — an Enterprise customer with an
 * office in Taiwan and another in Hong Kong.
 *
 * Orthogonal to markets and areas: two sites can work the same markets. A
 * workspace answers "which office does this belong to", not "which territory".
 *
 * `workspace_id` being NULL on a user means org-wide visibility (the
 * customer's head-office admin). Note this is unrelated to the `admin_global`
 * role, which is Insight Software staff and not a customer role at all.
 *
 * Billing is per site beyond the first: the main site is included with the
 * plan, each additional one is $300/mo (see the product brief, Aug 2026).
 */
export interface Workspace {
  id: string
  organization_id: string
  name: string
  is_active: boolean
  created_at: string
}

/**
 * Una entrada del padrón de SSO: alguien autorizado a entrar por el IdP de su
 * organización, con los atributos que tendrá su perfil cuando lo haga.
 *
 * Existe porque Supabase Auth no enlaza identidades — ver docs/PLAN-SSO.md. El
 * IdP prueba QUIÉN es la persona; esta tabla decide si tiene permiso de estar
 * acá y con qué alcance. Son dos preguntas distintas.
 *
 * La fila se consume en el primer login exitoso: se crea el perfil en `users`
 * con estos valores y la entrada se borra.
 */
export interface SsoRosterEntry {
  id: string
  organization_id: string
  /** Siempre en minúsculas — hay un CHECK que lo garantiza, porque la búsqueda
   *  al momento del login compara contra el email que manda el IdP. */
  email: string
  role: 'admin' | 'sdr'
  /** NOT NULL: un SDR sin área ve un CRM vacío que parece roto. */
  area_id: string
  /** null = toda la organización, igual que en {@link User.workspace_id}. */
  workspace_id: string | null
  created_by: string | null
  created_at: string
}

export interface UserArea {
  id: string
  user_id: string
  area_id: string
  created_at: string
  area?: Area
}

export interface MonthlyLeadCount {
  id: string
  organization_id: string
  year_month: string
  count: number
  created_at: string
  updated_at: string
}
