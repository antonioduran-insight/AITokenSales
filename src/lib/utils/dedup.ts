import { createClient } from '@/lib/supabase/client'

export interface DuplicateCheckResult {
  isDuplicate: boolean
  duplicateType: 'email' | 'linkedin' | 'both' | null
  existingProspect?: {
    id: string
    name: string
    area_id: string
    assigned_to: string | null
  }
}

export async function checkDuplicate(
  email?: string | null,
  linkedinUrl?: string | null
): Promise<DuplicateCheckResult> {
  if (!email && !linkedinUrl) return { isDuplicate: false, duplicateType: null }

  const supabase = createClient()
  let emailMatch = null
  let linkedinMatch = null

  if (email) {
    const { data } = await supabase
      .from('prospects')
      .select('id, name, area_id, assigned_to')
      .eq('email', email)
      .maybeSingle()
    emailMatch = data
  }

  if (linkedinUrl) {
    const { data } = await supabase
      .from('prospects')
      .select('id, name, area_id, assigned_to')
      .eq('linkedin_url', linkedinUrl)
      .maybeSingle()
    linkedinMatch = data
  }

  if (emailMatch && linkedinMatch) {
    return { isDuplicate: true, duplicateType: 'both', existingProspect: emailMatch }
  }
  if (emailMatch) {
    return { isDuplicate: true, duplicateType: 'email', existingProspect: emailMatch }
  }
  if (linkedinMatch) {
    return { isDuplicate: true, duplicateType: 'linkedin', existingProspect: linkedinMatch }
  }
  return { isDuplicate: false, duplicateType: null }
}
