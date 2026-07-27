export type OutreachStatus =
  | 'new'
  | 'connection_sent'
  | 'connected'
  | 'replied'
  | 'demo_scheduled'
  | 'closed'
  | 'nurture'

export type LeadTemperature = 'Cold' | 'Warm' | 'Hot'

export type SearchCombo = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

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
  // CRM fields
  outreach_status: OutreachStatus
  market: string | null
  area_id: string
  assigned_to: string | null
  flag_tomorrow: boolean
  source: 'manual' | 'csv_import'
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
export const SEARCH_COMBOS: SearchCombo[] = ['A', 'B', 'C', 'D', 'E', 'F']
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
  default_language: string
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
  language: string
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

export const ADDON_LIST = [
  { type: 'account_management', labelKey: 'addOn_account_management', price: '$149/mo' },
  { type: 'multi_workspace', labelKey: 'addOn_multi_workspace', price: '$300/mo' },
  { type: 'extended_data_retention', labelKey: 'addOn_extended_data_retention', price: '$99/mo' },
  { type: 'sso', labelKey: 'addOn_sso', price: '$299 one-time' },
  { type: 'linkedin_auto_messaging', labelKey: 'addOn_linkedin_auto_messaging', price: 'TBD' },
  { type: 'bridge', labelKey: 'addOn_bridge', price: 'TBD' },
] as const

// Recurring monthly price per add-on, used by Revenue Reports. One-time / TBD
// add-ons (sso, linkedin_auto_messaging) contribute 0 to the monthly run-rate.
export const ADDON_MONTHLY_PRICE: Record<string, number> = {
  account_management: 149,
  multi_workspace: 300,
  extended_data_retention: 99,
  sso: 99,
  linkedin_auto_messaging: 0,
  bridge: 0, // TBD
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
