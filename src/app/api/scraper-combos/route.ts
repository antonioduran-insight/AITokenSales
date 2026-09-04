import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  COMPANY_HEADCOUNTS,
  MAX_COMBO_TITLE_KEYWORDS,
  SENIORITY_LEVELS,
} from '@/lib/types'

/**
 * The search-strategy ("combo") catalogue for the caller's organization.
 *
 * Two kinds of row live in `scraper_combos_master`, told apart by
 * `organization_id` (see `supabase/migrations/20260904_org_owned_combos.sql`):
 *
 *  - `NULL` — the global catalogue Insight Software maintains. Every org reads
 *    it and toggles rows on/off through `org_combos`; nobody but `admin_global`
 *    can change what a global row actually searches for.
 *  - a real org id — a combo that org wrote itself. Only they can see it, and
 *    only their admin can edit or delete it.
 *
 * Verbs, kept apart on purpose so the toggle's contract never changes shape:
 *   GET    — the catalogue (global + own), each row carrying `org_active`
 *   POST   — toggle a combo on/off for this org (writes `org_combos`)
 *   PUT    — create a custom combo
 *   PATCH  — edit a custom combo
 *   DELETE — delete a custom combo
 *
 * All of them use the session client, so RLS is the real boundary: the policies
 * added by that migration are what stop one org reading or writing another's
 * combos. The explicit `organization_id` filters below are defence in depth,
 * matching how the rest of this codebase treats service-role-free routes.
 */

type Caller = { organizationId: string | null; role: string | null }

async function getCaller(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Caller | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  return { organizationId: data?.organization_id ?? null, role: data?.role ?? null }
}

function isAdmin(role: string | null): boolean {
  return role === 'admin' || role === 'admin_global'
}

/** A code no global combo can collide with, and no human has to invent. */
function mintCustomCode(): string {
  return `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

type ComboFields = {
  name: string
  description: string | null
  title_keywords: string[]
  seniority_levels: string[]
  company_headcounts: string[]
}

/**
 * Validate a custom combo's payload.
 *
 * `seniority_levels` and `company_headcounts` are checked against the actor's
 * own enums rather than being passed through: an unrecognised seniority value
 * makes the Apify actor reject the entire input, failing the run. The backend
 * drops unknown values defensively, but a dropped value is a filter the
 * customer believes they set — better to refuse the save than to accept it and
 * quietly search for something else.
 */
function parseFields(body: Record<string, unknown>, partial: boolean): ComboFields | { error: string } {
  const out: Partial<ComboFields> = {}

  if (!partial || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return { error: 'name is required' }
    if (name.length > 80) return { error: 'name must be 80 characters or fewer' }
    out.name = name
  }

  if (!partial || 'description' in body) {
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length > 300) return { error: 'description must be 300 characters or fewer' }
    out.description = description || null
  }

  if (!partial || 'title_keywords' in body) {
    const raw = Array.isArray(body.title_keywords) ? body.title_keywords : []
    const keywords = [...new Set(
      raw.filter((k): k is string => typeof k === 'string').map(k => k.trim()).filter(Boolean)
    )]
    if (keywords.length === 0) {
      return { error: 'At least one job title is required — a combo with no titles searches for nothing' }
    }
    if (keywords.length > MAX_COMBO_TITLE_KEYWORDS) {
      return { error: `At most ${MAX_COMBO_TITLE_KEYWORDS} job titles` }
    }
    out.title_keywords = keywords
  }

  if (!partial || 'seniority_levels' in body) {
    const raw = Array.isArray(body.seniority_levels) ? body.seniority_levels : []
    const levels = [...new Set(raw.filter((l): l is string => typeof l === 'string'))]
    const unknown = levels.filter(l => !(SENIORITY_LEVELS as readonly string[]).includes(l))
    if (unknown.length > 0) return { error: `Unsupported seniority level(s): ${unknown.join(', ')}` }
    out.seniority_levels = levels
  }

  if (!partial || 'company_headcounts' in body) {
    const raw = Array.isArray(body.company_headcounts) ? body.company_headcounts : []
    const sizes = [...new Set(raw.filter((h): h is string => typeof h === 'string'))]
    const unknown = sizes.filter(h => !(COMPANY_HEADCOUNTS as readonly string[]).includes(h))
    if (unknown.length > 0) return { error: `Unsupported company size(s): ${unknown.join(', ')}` }
    out.company_headcounts = sizes
  }

  return out as ComboFields
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await req.text()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function GET() {
  const supabase = await createClient()
  const caller = await getCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = caller.organizationId

  // Global rows plus this org's own. RLS already enforces exactly this, but the
  // filter is spelled out because `admin_global` has a cross-org policy on this
  // table — without it, an admin_global opening a CRM page would see every
  // customer's private combos mixed into the catalogue.
  let query = supabase.from('scraper_combos_master').select('*').eq('is_active', true)
  query = orgId
    ? query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
    : query.is('organization_id', null)

  const [masterRes, orgRes] = await Promise.all([
    query,
    supabase.from('org_combos').select('combo_code, is_active').eq('organization_id', orgId),
  ])

  const orgMap = Object.fromEntries(
    (orgRes.data ?? []).map(c => [c.combo_code, c.is_active])
  )

  // Global catalogue first in its curated `position` order, then the org's own
  // combos newest last, so a customer's list doesn't reshuffle when we add a
  // row to the shared catalogue.
  const result = (masterRes.data ?? [])
    .map(combo => ({ ...combo, org_active: orgMap[combo.code] ?? false }))
    .sort((a, b) => {
      const aOwn = a.organization_id ? 1 : 0
      const bOwn = b.organization_id ? 1 : 0
      if (aOwn !== bOwn) return aOwn - bOwn
      if (aOwn === 0) return (a.position ?? 0) - (b.position ?? 0)
      return String(a.created_at).localeCompare(String(b.created_at))
    })

  return NextResponse.json(result)
}

/** Toggle a combo on or off for this org. Unchanged contract. */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const caller = await getCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { combo_code, is_active } = await req.json()
  if (!combo_code || typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'combo_code and is_active required' }, { status: 400 })
  }

  // `org_combos.combo_code` is an FK to `scraper_combos_master(code)` and
  // nothing else, so before per-org combos existed any code that passed the FK
  // was by definition a code everybody shared. Now it isn't: without this
  // check an admin could switch on another customer's private combo — it would
  // never appear in their Settings list (that query is scoped), but the run
  // would search LinkedIn with that customer's title keywords. The backend
  // refuses to load it too (`get_combo_definitions`); this is the near end of
  // the same fence, and it fails loudly instead of silently finding nothing.
  const { data: definition } = await supabase
    .from('scraper_combos_master')
    .select('code, organization_id')
    .eq('code', combo_code)
    .maybeSingle()

  const ownsIt = definition
    && (definition.organization_id === null || definition.organization_id === caller.organizationId)
  if (!ownsIt) {
    return NextResponse.json({ error: 'Unknown combo' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('org_combos')
    .upsert(
      { organization_id: caller.organizationId, combo_code, is_active },
      { onConflict: 'organization_id,combo_code' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

/** Create a combo owned by this org, and switch it on for them. */
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const caller = await getCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  if (!caller.organizationId) {
    return NextResponse.json({ error: 'This account belongs to no organization' }, { status: 400 })
  }

  const fields = parseFields(await readBody(req), false)
  if ('error' in fields) return NextResponse.json({ error: fields.error }, { status: 400 })

  const code = mintCustomCode()

  const { data, error } = await supabase
    .from('scraper_combos_master')
    .insert({
      code,
      organization_id: caller.organizationId,
      name: fields.name,
      description: fields.description,
      title_keywords: fields.title_keywords,
      seniority_levels: fields.seniority_levels,
      company_headcounts: fields.company_headcounts,
      functions: [],
      is_active: true,
      // Sorted after the global catalogue by the GET above, which orders by
      // ownership first — `position` only orders global rows, so any value
      // works here. 0 keeps it honest rather than inventing a rank.
      position: 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Writing your own combo IS the decision to use it — making the admin go
  // find it in the list and toggle it on afterwards is a step with no question
  // behind it. Failure here is not fatal: the combo exists and the toggle is
  // right there, so report the row rather than rolling back a good insert.
  const { error: toggleError } = await supabase
    .from('org_combos')
    .upsert(
      { organization_id: caller.organizationId, combo_code: code, is_active: true },
      { onConflict: 'organization_id,combo_code' }
    )

  return NextResponse.json({ ...data, org_active: !toggleError })
}

/** Edit a combo this org owns. Global catalogue rows are not editable here. */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const caller = await getCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const body = await readBody(req)
  const code = typeof body.code === 'string' ? body.code : ''
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const fields = parseFields(body, true)
  if ('error' in fields) return NextResponse.json({ error: fields.error }, { status: 400 })
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // `.not('organization_id', 'is', null)` alongside the org match: a global row
  // has organization_id NULL, and `NULL = <org>` is NULL rather than false, so
  // the equality alone is not a statement about global rows. RLS refuses them
  // too — this just makes the intent readable at the call site.
  const { data, error } = await supabase
    .from('scraper_combos_master')
    .update(fields)
    .eq('code', code)
    .eq('organization_id', caller.organizationId)
    .not('organization_id', 'is', null)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) {
    return NextResponse.json(
      { error: 'No custom combo with that code in this organization' },
      { status: 404 }
    )
  }
  return NextResponse.json(data)
}

/**
 * Delete a combo this org owns.
 *
 * `org_combos.combo_code` is an FK with ON DELETE CASCADE, so the org's toggle
 * row goes with it. Leads already found by this combo keep the code in
 * `prospects.search_combo` and render it raw — the same fallback
 * `useComboLabels()` already applies to a combo that was switched off — because
 * deleting a strategy should not rewrite the history of what it found.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const caller = await getCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(caller.role)) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('scraper_combos_master')
    .delete()
    .eq('code', code)
    .eq('organization_id', caller.organizationId)
    .not('organization_id', 'is', null)
    .select('code')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'No custom combo with that code in this organization' },
      { status: 404 }
    )
  }
  return NextResponse.json({ deleted: true, code })
}
