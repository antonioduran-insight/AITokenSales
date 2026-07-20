import type { SupabaseClient } from '@supabase/supabase-js'
import { currentBillingPeriod } from './billing-period'

const MAX_INT = 2147483647

export interface LeadQuota {
  used: number
  max: number
  available: number
  unlimited: boolean
  period_start: string
  period_end: string
}

/**
 * Compute the org's lead usage for the CURRENT billing period (renews on
 * `billing_day`, not calendar month). Usage is the number of scraper leads
 * imported into the CRM (`exported_to_crm = true`) within the period — this is
 * the source of truth for leads consumed against the monthly allowance.
 *
 * Pass a service-role client so RLS never hides rows from the count.
 */
export async function getLeadQuota(
  admin: SupabaseClient,
  organizationId: string,
  billingDay: number,
  maxLeadsPerMonth: number | null
): Promise<LeadQuota> {
  const { start, end } = currentBillingPeriod(billingDay || 1)

  const { count } = await admin
    .from('scraper_leads')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('exported_to_crm', true)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())

  const used = count ?? 0
  const max = maxLeadsPerMonth ?? 1000
  const unlimited = max >= MAX_INT
  const available = unlimited ? MAX_INT : Math.max(0, max - used)

  return {
    used,
    max,
    available,
    unlimited,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
  }
}
