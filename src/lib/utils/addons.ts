import { createAdminClient } from '@/lib/supabase/admin'

// Mirrors the is_active flag every existing add-on already uses in
// organization_addons — "is this add-on on" always means a matching row
// with is_active = true, nothing add-on-specific.
export async function orgHasActiveAddon(organizationId: string, addonType: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_addons')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('addon_type', addonType)
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}
