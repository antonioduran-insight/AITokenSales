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
 * The opaque combo code stored in `prospects.search_combo`. The DB CHECK is
 * `search_combo = ANY (ARRAY['combo_A','combo_B','combo_C','combo_D','combo_E','combo_F'])`
 * (verified with `pg_get_constraintdef`), so these are the literal codes —
 * never the bare letters, which the DB rejects. Same vocabulary as
 * `scraper_combos_master.code` and `runs.combos`; resolve to a human label
 * with `useComboLabels()` rather than rendering the code.
 */
export type SearchCombo = 'combo_A' | 'combo_B' | 'combo_C' | 'combo_D' | 'combo_E' | 'combo_F'

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
export const SEARCH_COMBOS: SearchCombo[] = ['combo_A', 'combo_B', 'combo_C', 'combo_D', 'combo_E', 'combo_F']

/**
 * Tolerant parser for a `search_combo` coming from a CSV or a human: accepts
 * `combo_D`, `combo_d`, `Combo D`, `COMBO-D`, `D` and `d`, all normalising to
 * `combo_D`. Anything unrecognised returns `null` (the column is nullable)
 * instead of being passed through to fail the DB CHECK — a single bad value
 * used to take a whole insert batch down with it.
 *
 * Lives here next to the constant, not in the wizard, because the CSV wizard
 * (client) and `PUT /api/import` (server) must agree on it exactly, and a
 * route handler must not import from a `'use client'` component.
 */
export function normalizeSearchCombo(value: unknown): SearchCombo | null {
  if (typeof value !== 'string') return null
  const letter = value.trim().toUpperCase().replace(/^COMBO[\s_-]*/, '')
  if (!/^[A-F]$/.test(letter)) return null
  return `combo_${letter}` as SearchCombo
}

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
  plan: 'basic' | 'premium' | 'enterprise' | 'ultra'
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
}

export type PlanName = 'basic' | 'premium' | 'enterprise' | 'ultra'

const ALL_PLANS: PlanName[] = ['basic', 'premium', 'enterprise', 'ultra']

/**
 * The add-on catalogue.
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
 * so a Premium org could be charged $149/mo for Account Management that its
 * plan already includes, and Multi-workspace (Enterprise-only) could be sold
 * to a Basic account.
 */
export const ADDON_LIST = [
  {
    type: 'account_management', labelKey: 'addOn_account_management', price: '$149/mo',
    // Brief: "Basic 加購；Premium／Enterprise 已內含" — a Basic upsell, and
    // already part of the two plans above it.
    plans: ['basic', 'ultra'] as PlanName[],
    includedIn: ['premium', 'enterprise'] as PlanName[],
  },
  {
    type: 'multi_workspace', labelKey: 'addOn_multi_workspace', price: '$300/mo per site',
    // Brief: "僅 Enterprise". Priced per site; the main one comes with the
    // plan, so Revenue Reports charges (active sites − 1).
    plans: ['enterprise', 'ultra'] as PlanName[],
    includedIn: [] as PlanName[],
  },
  {
    type: 'extended_data_retention', labelKey: 'addOn_extended_data_retention', price: '$99/mo',
    plans: ALL_PLANS,
    includedIn: [] as PlanName[],
  },
  {
    type: 'sso', labelKey: 'addOn_sso', price: '$299 one-time',
    plans: ['premium', 'enterprise', 'ultra'] as PlanName[],
    includedIn: [] as PlanName[],
  },
  {
    type: 'linkedin_auto_messaging', labelKey: 'addOn_linkedin_auto_messaging', price: 'TBD',
    plans: ['premium', 'enterprise', 'ultra'] as PlanName[],
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
  account_management: 149,
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
