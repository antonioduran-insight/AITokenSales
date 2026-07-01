import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}

export async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, role, organization_id, area_id')
    .eq('id', user.id)
    .single()

  return data ?? null
}

export function isGlobalAdmin(user: { role?: string; organization_id?: string | null } | null) {
  return user?.role === 'admin' && (user?.organization_id === null || user?.organization_id === undefined)
}

export function isOrgAdmin(user: { role?: string; organization_id?: string | null } | null) {
  return user?.role === 'admin' && user?.organization_id != null
}
