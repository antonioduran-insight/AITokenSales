import { createClient } from '@/lib/supabase/client'

export async function getCurrentOrganizationId(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  return data?.organization_id ?? null
}

export async function isGlobalAdmin(): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  return data?.role === 'admin' && data?.organization_id === null
}
