import { createClient } from '@/lib/supabase/client'

interface AuditEvent {
  event_type: string
  prospect_id?: string
  prospect_name?: string
  metadata?: Record<string, unknown>
}

/**
 * Write one audit_log row.
 *
 * Returns true when the row was actually written. Callers that show a success
 * toast (or that only make sense if the trail was recorded) must check it —
 * this used to swallow every failure, which is how `prospect_updated` went
 * unnoticed: the CHECK constraint on audit_log.event_type didn't include that
 * value, so every insert failed with 23505/23514 and nothing anywhere said so.
 * 711 audit events existed and not one of them was a prospect field edit.
 *
 * The error is also logged to the console, because a silent audit trail is
 * worse than a noisy one: this is the table people consult precisely when a
 * value doesn't add up.
 */
export async function logAuditEvent(event: AuditEvent): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, organization_id')
    .eq('id', user.id)
    .single()

  const { error } = await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_name: userData?.full_name ?? user.email ?? 'Unknown',
    organization_id: userData?.organization_id ?? null,
    ...event
  })

  if (error) {
    // 23514 here means event_type isn't in audit_log_event_type_check — adding
    // a new event type requires widening that constraint in a migration, the
    // same way addon_type does.
    console.error(
      `[audit] failed to record "${event.event_type}" (${error.code}): ${error.message}`
    )
    return false
  }

  return true
}
