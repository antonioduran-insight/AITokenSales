import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

async function verifyGlobalAdmin() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin_global') return null

  // `full_name` comes along for the audit trail: addon_audit_log snapshots the
  // actor's name rather than joining on an id, so the record survives the
  // staff account being deleted later.
  return { ...user, full_name: profile.full_name as string | null }
}

/**
 * Record an add-on activation/deactivation in the internal trail.
 *
 * Never blocks or fails the request it accompanies: the customer-visible
 * outcome of toggling an add-on must not depend on the history write
 * succeeding. A failure is logged loudly instead, because a silently missing
 * audit row is worse than a noisy one — this is the table consulted precisely
 * when a charge doesn't add up.
 */
async function recordAddonChange(entry: {
  organization_id: string
  addon_type: string
  action: 'activated' | 'deactivated'
  actor_id: string
  actor_name: string | null
  price_monthly?: number | null
}) {
  // Builds its own client rather than taking one as a parameter: typing the
  // parameter would mean `ReturnType<typeof createAdminClient>`, which is the
  // *uninstantiated* generic signature — every table resolves to `never` and
  // `.insert()` stops compiling. Constructing it here lets TypeScript infer
  // the concrete client the same way every other handler in this file does.
  // The client is a plain object with no connection pool, so this is cheap.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await admin.from('addon_audit_log').insert(entry)
  if (error) {
    console.error(
      `[addon-audit] failed to record "${entry.action}" of ${entry.addon_type} ` +
      `for org ${entry.organization_id} (${error.code}): ${error.message}`
    )
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('organization_addons')
    .select('*')
    .eq('organization_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { addon_type, price_monthly } = await req.json()

  if (!addon_type) return NextResponse.json({ error: 'addon_type required' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // A real upsert, resolved by the database rather than by a read followed by
  // a write. The previous check-then-insert was a race: two concurrent
  // activations of the same add-on both saw "not there" and both inserted,
  // and from then on every `.single()`/`.maybeSingle()` reader of this table
  // (the Bridge proxy's gate, requireAddon, this endpoint itself) failed —
  // turning a paid, active add-on into a 403. See the migration
  // 20260805_organization_addons_unique.sql for the full chain.
  //
  // Depends on the UNIQUE (organization_id, addon_type) constraint that
  // migration adds; without it applied, onConflict has nothing to match and
  // Postgres rejects the statement rather than silently duplicating — loud is
  // the correct failure mode here.
  const { error } = await admin
    .from('organization_addons')
    .upsert(
      {
        organization_id: id,
        addon_type,
        is_active: true,
        price_monthly: price_monthly ?? null,
        // `activated_at` is deliberately absent. ON CONFLICT DO UPDATE only
        // writes the columns present here, so omitting it means: a first-time
        // activation gets the column's `DEFAULT now()`, and re-activating one
        // that was switched off keeps its ORIGINAL date instead of resetting
        // it. That matches what the previous update-branch did, and the
        // original date is the one with billing meaning.
      },
      { onConflict: 'organization_id,addon_type' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recordAddonChange({
    organization_id: id,
    addon_type,
    action: 'activated',
    actor_id: user.id,
    actor_name: user.full_name,
    price_monthly: price_monthly ?? null,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyGlobalAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { addon_type } = await req.json()

  if (!addon_type) return NextResponse.json({ error: 'addon_type required' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Read the price before switching it off, so the trail records what the org
  // was actually being charged at the moment it was deactivated. Reading it
  // afterwards would still work today (deactivation doesn't clear the column)
  // but ties this record to that staying true.
  const { data: current } = await admin
    .from('organization_addons')
    .select('price_monthly')
    .eq('organization_id', id)
    .eq('addon_type', addon_type)
    .maybeSingle()

  const { error } = await admin
    .from('organization_addons')
    .update({ is_active: false })
    .eq('organization_id', id)
    .eq('addon_type', addon_type)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await recordAddonChange({
    organization_id: id,
    addon_type,
    action: 'deactivated',
    actor_id: user.id,
    actor_name: user.full_name,
    price_monthly: current?.price_monthly ?? null,
  })

  return NextResponse.json({ ok: true })
}
