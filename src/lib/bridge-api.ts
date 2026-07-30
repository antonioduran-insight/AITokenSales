// Client wrapper for the Bridge endpoints. Everything goes through
// /api/bridge/* , which authenticates the caller, checks the add-on and injects
// organization_id (and apify_token for runs) server-side.

export type ChannelFamily =
  | 'reseller'
  | 'referral'
  | 'technology_integration'
  | 'affiliate'
  | 'channel_distribution'

export const CHANNEL_FAMILIES: { value: ChannelFamily; label: string }[] = [
  { value: 'reseller', label: 'Reseller' },
  { value: 'referral', label: 'Referral' },
  { value: 'technology_integration', label: 'Technology Integration' },
  { value: 'affiliate', label: 'Affiliate' },
  { value: 'channel_distribution', label: 'Channel Distribution' },
]

export const HEADCOUNTS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+']

export interface SeedList {
  id: string
  name: string
  channel_family: ChannelFamily | string
  companies?: string[]
  criteria?: {
    industry?: string | null
    headcounts?: string[]
    market?: string | null
  } | null
  created_at?: string
}

export type BridgeRunStatus = 'pending' | 'running' | 'searching' | 'completed' | 'failed' | 'cancelled'

export interface BridgeRun {
  id: string
  seed_list_id: string
  seed_list_name?: string
  status: BridgeRunStatus | string
  candidates_found?: number
  created_at: string
}

export type VerificationStatus = 'pending' | 'confirmed' | 'rejected'

export interface BridgeCandidate {
  id: string
  run_id: string
  full_name?: string
  company?: string
  /** LinkedIn's internal id for the company — used to group candidates. */
  company_id?: string | null
  /** Company's LinkedIn page, when the backend could construct one. */
  company_linkedin_url?: string | null
  title?: string
  location?: string
  linkedin_url?: string
  bio?: string
  verification_status: VerificationStatus | string
  /** SDR the candidate was assigned to when confirmed. */
  assigned_to?: string | null
  /** Personalised partnership messages generated on batch confirmation. */
  custom1?: string | null
  custom2?: string | null
}

export interface BridgeLog {
  id?: string
  level?: string
  message: string
  created_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/bridge${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request failed (${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}

// Some backends wrap collections ({ items: [...] }); normalise to a plain array.
function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    for (const key of ['items', 'data', 'results', 'seed_lists', 'runs', 'candidates', 'logs']) {
      const v = (data as Record<string, unknown>)[key]
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}

export const bridgeApi = {
  listSeedLists: async (): Promise<SeedList[]> =>
    asArray<SeedList>(await request('/seed-lists')),

  createSeedList: (payload: Record<string, unknown>) =>
    request<SeedList>('/seed-lists', { method: 'POST', body: JSON.stringify(payload) }),

  // Partial update: send ONLY the fields being changed. The backend applies
  // `exclude_unset`, so an omitted filter is left alone rather than cleared —
  // renaming a list does not wipe its companies. An explicit `[]` still clears
  // that filter, which is a real edit.
  updateSeedList: (id: string, changes: Record<string, unknown>) =>
    request<SeedList>(`/seed-lists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  // No local ownership check needed here beyond what the proxy already does
  // (org-scoped) — the backend owns seed lists entirely, same as create/list.
  deleteSeedList: (id: string) =>
    request<{ deleted?: boolean; id?: string }>(
      `/seed-lists/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  createRun: (seedListId: string) =>
    request<{ id?: string; run_id?: string }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ seed_list_id: seedListId }),
    }),

  listRuns: async (): Promise<BridgeRun[]> =>
    asArray<BridgeRun>(await request('/runs')),

  getRun: (id: string) => request<BridgeRun>(`/runs/${id}`),

  getLogs: async (id: string): Promise<BridgeLog[]> =>
    asArray<BridgeLog>(await request(`/runs/${id}/logs`)),

  listCandidates: async (runId: string): Promise<BridgeCandidate[]> =>
    asArray<BridgeCandidate>(await request(`/candidates?run_id=${encodeURIComponent(runId)}`)),

  setCandidateStatus: (id: string, status: VerificationStatus) =>
    request<BridgeCandidate>(`/candidates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ verification_status: status }),
    }),

  /**
   * Confirm several candidates at once and generate a personalised message for
   * each. `organization_id`, the Anthropic credentials, the Bridge context and
   * the SDR's sender profile are all injected server-side by the proxy.
   */
  confirmBatch: (candidateIds: string[], sdrId: string) =>
    request<{
      confirmed?: number
      candidates?: BridgeCandidate[]
      // Added by the proxy after it hands the confirmed candidates over to
      // `prospects` (assignBridgeCandidates). Before this existed the UI
      // reported `candidate_ids.length` blindly — which is how it announced
      // "9 candidates confirmed and assigned to Antonio" on a run where zero
      // of them ever reached the SDR's board.
      crm_prospects_created?: number
      crm_prospects_not_created?: number
      crm_prospects_skipped_existing?: number
      crm_prospects_skipped_no_name?: number
      crm_prospects_error?: string | null
    }>('/candidates/confirm-batch', {
      method: 'POST',
      body: JSON.stringify({ candidate_ids: candidateIds, sdr_id: sdrId }),
    }),
}
