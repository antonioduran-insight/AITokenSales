import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('id, role').eq('id', user.id).single()
  return profile ? { ...user, role: profile.role as string } : null
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/conversations?prospect_id=...
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prospect_id = req.nextUrl.searchParams.get('prospect_id')
  if (!prospect_id) return NextResponse.json({ error: 'prospect_id required' }, { status: 400 })

  const db = adminClient()

  // SDR: verify prospect is assigned to them
  if (user.role === 'sdr') {
    const { data: prospect } = await db
      .from('prospects')
      .select('assigned_to')
      .eq('id', prospect_id)
      .single()
    if (prospect?.assigned_to !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data, error } = await db
    .from('conversations')
    .select('*, author:users!author_id(id, full_name, email, role, area_id, is_active, created_at)')
    .eq('prospect_id', prospect_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/conversations
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { prospect_id, chat_content, reason } = body
  if (!prospect_id || !chat_content) {
    return NextResponse.json({ error: 'prospect_id and chat_content required' }, { status: 400 })
  }

  const db = adminClient()

  // SDR: verify prospect is assigned to them
  if (user.role === 'sdr') {
    const { data: prospect } = await db
      .from('prospects')
      .select('assigned_to')
      .eq('id', prospect_id)
      .single()
    if (prospect?.assigned_to !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data, error } = await db
    .from('conversations')
    .insert({
      prospect_id,
      author_id: user.id,
      chat_content: chat_content.trim(),
      reason: reason ?? '',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
