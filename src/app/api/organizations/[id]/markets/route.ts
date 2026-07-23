import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Market } from '@/lib/types'

/**
 * Resolve the caller and make sure they may act on `orgId`.
 *
 * The org id is in the URL for readability, but it is never trusted: it must
 * match the caller's own organization (admin_global may target any org).
 * Reads are open to any member of the org; writes are admin-only.
 */
async function authorize(orgId: string, opts: { write: boolean }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: userData } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!userData) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const isGlobal = userData.role === 'admin_global'
  if (!isGlobal && userData.organization_id !== orgId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (opts.write && !isGlobal && userData.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Only the organization admin can change markets' }, { status: 403 }) }
  }

  return { ok: true as const }
}

// Same normalisation as /api/markets — the backend owns the table's shape.
function normalize(row: Record<string, unknown>): Market {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? row.country ?? row.label ?? ''),
    region: String(row.region ?? row.area ?? row.continent ?? 'Other'),
  }
}

/** GET — the markets this organization has activated. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  const auth = await authorize(orgId, { write: false })
  if ('error' in auth) return auth.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_markets')
    .select('market_id, markets(*)')
    .eq('organization_id', orgId)

  if (error) {
    return NextResponse.json(
      { error: `Could not read this organization's markets: ${error.message}` },
      { status: 500 }
    )
  }

  // PostgREST types a `markets(*)` embed as an array even though it is to-one,
  // so accept either shape.
  type Row = { market_id: string; markets?: Record<string, unknown> | Record<string, unknown>[] | null }
  const rows = (data ?? []) as unknown as Row[]

  const markets: Market[] = rows
    .map(r => {
      const embedded = Array.isArray(r.markets) ? r.markets[0] : r.markets
      return embedded ? normalize(embedded) : { id: String(r.market_id), name: '', region: 'Other' }
    })
    .filter(m => m.id && m.name)
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))

  return NextResponse.json(markets)
}

/**
 * PUT — replace the organization's market selection.
 *
 * Body: `{ market_ids: string[] }`. Only the difference is written: newly
 * checked markets are inserted and unchecked ones deleted, so untouched rows
 * keep their ids and any metadata the backend stores on them.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  const auth = await authorize(orgId, { write: true })
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({}))
  const incoming: unknown = body?.market_ids
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: 'market_ids must be an array' }, { status: 400 })
  }
  const wanted = new Set(incoming.map(String).filter(Boolean))

  const admin = createAdminClient()

  // Reject ids that aren't in the catalogue rather than writing dangling rows.
  if (wanted.size > 0) {
    const { data: valid } = await admin.from('markets').select('id').in('id', [...wanted])
    const validIds = new Set((valid ?? []).map(m => String(m.id)))
    const unknown = [...wanted].filter(id => !validIds.has(id))
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown market ids: ${unknown.join(', ')}` }, { status: 400 })
    }
  }

  const { data: existingRows, error: readErr } = await admin
    .from('organization_markets')
    .select('market_id')
    .eq('organization_id', orgId)

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  const existing = new Set((existingRows ?? []).map(r => String(r.market_id)))
  const toAdd = [...wanted].filter(id => !existing.has(id))
  const toRemove = [...existing].filter(id => !wanted.has(id))

  if (toRemove.length > 0) {
    const { error } = await admin
      .from('organization_markets')
      .delete()
      .eq('organization_id', orgId)
      .in('market_id', toRemove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (toAdd.length > 0) {
    const { error } = await admin
      .from('organization_markets')
      .insert(toAdd.map(market_id => ({ organization_id: orgId, market_id })))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length, total: wanted.size })
}
