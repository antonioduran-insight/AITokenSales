import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/conversations/counts?ids=uuid1,uuid2,...
// Returns { [prospect_id]: count } using service role to bypass RLS
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('ids')
  if (!raw) return NextResponse.json({})

  const ids = raw.split(',').filter(Boolean)
  if (ids.length === 0) return NextResponse.json({})

  const db = adminClient()
  const { data } = await db
    .from('conversations')
    .select('prospect_id')
    .in('prospect_id', ids)

  const countMap: Record<string, number> = {}
  data?.forEach(c => {
    countMap[c.prospect_id] = (countMap[c.prospect_id] ?? 0) + 1
  })

  return NextResponse.json(countMap)
}
