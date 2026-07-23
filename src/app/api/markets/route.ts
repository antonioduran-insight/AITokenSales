import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Market } from '@/lib/types'

/**
 * Full market catalogue (~49 countries grouped into 4 regions).
 *
 * The `markets` table is owned by the scraper backend, so the column names are
 * normalised here rather than assumed: the country can arrive as `name`,
 * `country` or `label`, and the region as `region`, `area` or `continent`.
 * Read with the service role because the catalogue is global (not org-scoped)
 * and may not carry a permissive RLS policy.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('markets').select('*')

  if (error) {
    return NextResponse.json(
      { error: `Could not read the markets catalogue: ${error.message}` },
      { status: 500 }
    )
  }

  const markets: Market[] = (data ?? [])
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? row.country ?? row.label ?? ''),
      region: String(row.region ?? row.area ?? row.continent ?? 'Other'),
    }))
    .filter(m => m.id && m.name)
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))

  return NextResponse.json(markets)
}
