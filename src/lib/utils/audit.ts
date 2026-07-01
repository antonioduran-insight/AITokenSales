import { createClient } from '@/lib/supabase/client'

interface AuditEvent {
  event_type: string
  prospect_id?: string
  prospect_name?: string
  metadata?: Record<string, unknown>
}

export async function logAuditEvent(event: AuditEvent) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, organization_id')
    .eq('id', user.id)
    .single()

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_name: userData?.full_name ?? user.email ?? 'Unknown',
    organization_id: userData?.organization_id ?? null,
    ...event
  })
}
