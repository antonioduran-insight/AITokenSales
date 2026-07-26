import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getCaller() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('role, organization_id').eq('id', user.id).single()
  if (!profile) return null
  return { role: profile.role as string, organizationId: profile.organization_id as string | null }
}

// GET /api/conversations/counts?ids=uuid1,uuid2,...&impersonate_org_id=...
// Returns { [prospect_id]: count } using service role to bypass RLS.
//
// Scoped to the caller's own organization (or, for admin_global, the
// explicitly impersonated org) so a prospect id from another org can't be
// probed for its conversation count. Scoping goes through `prospects`, not
// `conversations.organization_id` — that column isn't guaranteed populated
// on every row (see the same caveat in /api/crm/[table]), so trusting it
// directly could under- or over-scope.
export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const impersonateOrgId = req.nextUrl.searchParams.get('impersonate_org_id')
  let orgId: string | null = caller.organizationId

  if (impersonateOrgId) {
    if (caller.role !== 'admin_global') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    orgId = impersonateOrgId
  }

  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('ids')
  if (!raw) return NextResponse.json({})

  const ids = raw.split(',').filter(Boolean)
  if (ids.length === 0) return NextResponse.json({})

  const db = adminClient()

  // Only count for ids that are actually prospects in this org.
  const { data: ownProspects } = await db
    .from('prospects')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', ids)
  const scopedIds = (ownProspects ?? []).map(p => p.id as string)
  if (scopedIds.length === 0) return NextResponse.json({})

  const { data } = await db
    .from('conversations')
    .select('prospect_id')
    .in('prospect_id', scopedIds)

  const countMap: Record<string, number> = {}
  data?.forEach(c => {
    countMap[c.prospect_id] = (countMap[c.prospect_id] ?? 0) + 1
  })

  return NextResponse.json(countMap)
}
