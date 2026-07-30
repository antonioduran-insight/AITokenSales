'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  bridgeApi, CHANNEL_FAMILIES, HEADCOUNTS,
  type SeedList, type BridgeRun, type BridgeCandidate, type VerificationStatus,
} from '@/lib/bridge-api'
import { Plus, X, ExternalLink, Check, Ban, RotateCcw, AlertCircle, Handshake, Building2, Trash2, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useOrgMarkets } from '@/lib/hooks/useOrgMarkets'
import { MarketSelect } from '@/components/markets/MarketSelect'
import { INDUSTRY_BY_ID, searchIndustries } from '@/lib/industry-codes'

const ACTIVE = new Set(['pending', 'running', 'searching'])

// Run status → key inside the `bridge` namespace. Module scope has no
// translator, so only the key lives here; it's resolved with `t()` in the JSX.
const PROGRESS_KEY: Record<string, string> = {
  pending: 'progressInitializing',
  running: 'progressSearching',
  searching: 'progressSearching',
}

// Statuses we actually ship a label for. The backend owns both vocabularies and
// can add a value we don't know — fall back to the raw string rather than
// rendering an i18n key/error in its place.
const RUN_STATES = new Set(['pending', 'running', 'searching', 'completed', 'failed', 'cancelled'])
const CANDIDATE_STATES = new Set(['pending', 'confirmed', 'rejected'])

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 980, margin: '0 auto' },
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  label: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 10 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 13, outline: 'none' },
  badge: { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, backgroundColor: '#6C63FF15', border: '1px solid #6C63FF30', color: 'var(--crm-accent)' },
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : 'var(--crm-text-secondary)', transition: 'all .15s',
  }
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : 'var(--crm-text-secondary)',
  }
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  confirmed: { bg: '#22C55E20', color: '#22C55E' },
  rejected: { bg: '#EF444420', color: '#EF4444' },
  pending: { bg: 'var(--crm-surface-raised)', color: 'var(--crm-text-muted)' },
}

// Anything in this list means the message came from a layer the operator has
// no business seeing — the scraping vendor's validation errors, our own actor
// ids, Python exception reprs, raw JSON payloads. Real examples that reached
// this UI: `InvalidRequestError('Input is not valid: Field
// input.profileScraperMode must be equal to one of ...')`, which publishes the
// vendor's schema, and tracebacks naming internal modules.
const INTERNAL_ERROR_MARKERS = [
  'apify', 'harvestapi', 'actor', 'pydantic', 'traceback', 'input.',
  'profileScraperMode', 'InvalidRequestError', '{"', 'Field input',
]

/** Message safe to show; anything implementation-shaped becomes generic.
 *  The full text always goes to the console, so support can still see it. */
function safeErrorMessage(raw: unknown, fallback: string): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? '')
  console.error('[bridge] error:', raw)
  if (!text.trim()) return fallback
  const lower = text.toLowerCase()
  if (INTERNAL_ERROR_MARKERS.some(m => lower.includes(m.toLowerCase()))) return fallback
  // Long messages are almost always dumps rather than prose.
  if (text.length > 180) return fallback
  return text
}

export function BridgeClient() {
  const t = useTranslations('bridge')
  const tc = useTranslations('common')
  const [tab, setTab] = useState<'search' | 'history'>('search')
  const [error, setError] = useState<string | null>(null)
  const { markets: orgMarkets, loading: marketsLoading, error: marketsError } = useOrgMarkets()

  // ── Seed lists ──
  const [seedLists, setSeedLists] = useState<SeedList[]>([])
  const [loadingSeeds, setLoadingSeeds] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [savingSeed, setSavingSeed] = useState(false)
  // null = the form is creating; an id = it is editing that list in place.
  // One form serves both so the two paths can never drift apart in what they
  // send — which is how the original create ended up silently dropping every
  // filter it submitted.
  const [editingSeedId, setEditingSeedId] = useState<string | null>(null)

  // Seed list form — both modes can be combined
  const [name, setName] = useState('')
  const [channelFamily, setChannelFamily] = useState(CHANNEL_FAMILIES[0].value)
  const [useCompanies, setUseCompanies] = useState(true)
  const [useCriteria, setUseCriteria] = useState(false)
  const [companiesText, setCompaniesText] = useState('')
  // Real LinkedIn industry ids, not free text. The field used to be a plain
  // input whose value the proxy discarded (`industry_codes: []`), because no
  // name -> code mapping existed — while still counting as a valid criterion,
  // so a seed list filtered "by industry" actually searched unfiltered.
  const [industryIds, setIndustryIds] = useState<number[]>([])
  const [industryQuery, setIndustryQuery] = useState('')
  const [headcounts, setHeadcounts] = useState<string[]>([])
  const [market, setMarket] = useState<string | null>(null)

  // ── Run ──
  const [selectedSeedId, setSelectedSeedId] = useState('')
  const [starting, setStarting] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<BridgeRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Candidates ──
  const [candidates, setCandidates] = useState<BridgeCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [filter, setFilter] = useState<'all' | VerificationStatus>('all')
  const [updating, setUpdating] = useState<string | null>(null)

  // ── Batch confirmation ──
  // Bridge is not tied to scraper access or assigned markets, so any active SDR
  // in the org can receive candidates.
  const [sdrs, setSdrs] = useState<Array<{ id: string; full_name: string }>>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchSdrId, setBatchSdrId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [batchMsg, setBatchMsg] = useState<string | null>(null)
  // Separate from `batchMsg` (green) and `error` (red): a partial handoff to
  // `prospects` is neither a success nor a failure of the confirm itself.
  const [batchWarn, setBatchWarn] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Deliberately NOT reusing `expanded`: that one holds candidate ids (the
  // per-contact detail toggle) and this holds company group keys. Sharing one
  // Set would make a company_id that happens to match a candidate id expand
  // both, and reads as a bug that is very hard to spot.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // ── History ──
  const [runs, setRuns] = useState<BridgeRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)

  const loadSeedLists = useCallback(async () => {
    setLoadingSeeds(true)
    try { setSeedLists(await bridgeApi.listSeedLists()) }
    catch (e) { setError(safeErrorMessage(e, t('genericError'))) }
    finally { setLoadingSeeds(false) }
  }, [])

  useEffect(() => { loadSeedLists() }, [loadSeedLists])

  // ── Delete seed list ──
  const [deleteTarget, setDeleteTarget] = useState<SeedList | null>(null)
  const [deletingSeed, setDeletingSeed] = useState(false)

  async function confirmDeleteSeedList() {
    if (!deleteTarget) return
    setDeletingSeed(true)
    try {
      await bridgeApi.deleteSeedList(deleteTarget.id)
      setDeleteTarget(null)
      await loadSeedLists()
    } catch (e) {
      setError(safeErrorMessage(e, t('genericError')))
    } finally {
      setDeletingSeed(false)
    }
  }

  // Any active SDR in the org can receive Bridge candidates.
  useEffect(() => {
    createClient()
      .from('users')
      .select('id, full_name')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .then(({ data }) => setSdrs(data ?? []))
  }, [])

  const loadCandidates = useCallback(async (id: string) => {
    setLoadingCandidates(true)
    try { setCandidates(await bridgeApi.listCandidates(id)) }
    catch (e) { setError(safeErrorMessage(e, t('genericError'))) }
    finally { setLoadingCandidates(false) }
  }, [])

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    try { setRuns(await bridgeApi.listRuns()) }
    catch (e) { setError(safeErrorMessage(e, t('genericError'))) }
    finally { setLoadingRuns(false) }
  }, [])

  useEffect(() => { if (tab === 'history') loadRuns() }, [tab, loadRuns])

  // ── Poll the active run ──
  const poll = useCallback(async (id: string) => {
    try {
      // Logs are no longer fetched. They only ever fed the raw terminal that
      // has since been removed, so polling for them doubled every request in
      // this loop — two round-trips per tick, one payload discarded — to
      // retrieve output we deliberately do not show any more.
      const r = await bridgeApi.getRun(id)
      setRun(r)
      if (!ACTIVE.has(r.status)) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        if (r.status === 'completed') loadCandidates(id)
      }
    } catch { /* transient */ }
  }, [loadCandidates])

  useEffect(() => {
    if (!runId) return
    poll(runId)
    pollRef.current = setInterval(() => poll(runId), 3000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // ── Actions ──
  function toggleHeadcount(h: string) {
    setHeadcounts(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h])
  }

  function resetForm() {
    setName(''); setChannelFamily(CHANNEL_FAMILIES[0].value)
    setUseCompanies(true); setUseCriteria(false)
    setCompaniesText(''); setIndustryIds([]); setIndustryQuery(''); setHeadcounts([]); setMarket(null)
  }

  const companies = companiesText
    .split(/[\n,]/).map(c => c.trim()).filter(Boolean)

  const canSaveSeed = !!name.trim()
    && (useCompanies || useCriteria)
    && (!useCompanies || companies.length > 0)
    && (!useCriteria || industryIds.length > 0 || headcounts.length > 0 || !!market)

  // Load an existing list into the same form the create flow uses, rather than
  // building a second one. The backend stores its own field names
  // (company_names / company_headcounts / geo_codes), so this is the inverse of
  // the proxy's transform: back into the shape the form speaks.
  function startEditSeedList(sl: SeedList) {
    const seedCompanies = (sl.company_names ?? []) as string[]
    const seedHeadcounts = (sl.company_headcounts ?? []) as string[]

    setEditingSeedId(sl.id)
    setName(sl.name ?? '')
    setChannelFamily((sl.channel_family as typeof channelFamily) ?? CHANNEL_FAMILIES[0].value)
    setCompaniesText(seedCompanies.join('\n'))
    setHeadcounts(seedHeadcounts)
    // Industry round-trips now that the codes are real numbers on both sides.
    setIndustryIds((sl.industry_codes ?? []) as number[])
    setIndustryQuery('')
    // Market is stored as geo_codes, and resolving those back to a market name
    // would need a lookup this form doesn't do. Left unset: the user re-picks
    // it only if they open the criteria section, and an untouched section is
    // never sent, so the stored value survives.
    setMarket(null)
    setUseCompanies(seedCompanies.length > 0)
    setUseCriteria(seedHeadcounts.length > 0 || (sl.industry_codes?.length ?? 0) > 0)
    setShowForm(true)
  }

  function closeSeedForm() {
    resetForm()
    setEditingSeedId(null)
    setShowForm(false)
  }

  async function saveSeedList() {
    if (!canSaveSeed || savingSeed) return
    setSavingSeed(true); setError(null)
    try {
      if (editingSeedId) {
        // PATCH sends only the sections the user actually enabled. The backend
        // leaves an omitted field untouched, so editing just the name cannot
        // blank out the filters — see the proxy's seed-list transform.
        const changes: Record<string, unknown> = {
          name: name.trim(),
          channel_family: channelFamily,
        }
        if (useCompanies) changes.companies = companies
        if (useCriteria) {
          changes.criteria = { industry_ids: industryIds, headcounts, market }
        }
        await bridgeApi.updateSeedList(editingSeedId, changes)
      } else {
        await bridgeApi.createSeedList({
          name: name.trim(),
          channel_family: channelFamily,
          companies: useCompanies ? companies : [],
          criteria: useCriteria ? {
            industry_ids: industryIds,
            headcounts,
            market,
          } : null,
        })
      }
      closeSeedForm()
      await loadSeedLists()
    } catch (e) {
      setError(safeErrorMessage(e, t('genericError')))
    } finally { setSavingSeed(false) }
  }

  async function startRun() {
    if (!selectedSeedId || starting) return
    setStarting(true); setError(null)
    try {
      const res = await bridgeApi.createRun(selectedSeedId)
      const id = res.id ?? res.run_id
      if (!id) throw new Error(t('errorNoRunId'))
      setCandidates([]); setRun(null)
      setRunId(id)
    } catch (e) {
      setError(safeErrorMessage(e, t('genericError')))
    } finally { setStarting(false) }
  }

  async function setStatus(c: BridgeCandidate, status: VerificationStatus) {
    setUpdating(c.id); setError(null)
    try {
      await bridgeApi.setCandidateStatus(c.id, status)
      setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, verification_status: status } : x))
    } catch (e) {
      setError(safeErrorMessage(e, t('genericError')))
    } finally { setUpdating(null) }
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setBatchMsg(null)
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Confirm every selected candidate at once; the backend generates a
  // personalised message per candidate and assigns them all to the chosen SDR.
  async function confirmBatch() {
    if (selectedIds.size === 0 || !batchSdrId || confirming) return
    setConfirming(true); setError(null); setBatchMsg(null); setBatchWarn(null)
    const ids = [...selectedIds]
    try {
      const res = await bridgeApi.confirmBatch(ids, batchSdrId)
      const name = sdrs.find(s => s.id === batchSdrId)?.full_name ?? t('theSdr')

      // Report what actually landed on the SDR's board, never `ids.length`.
      // Confirming and handing over to `prospects` are two separate steps: the
      // backend can confirm all 9 and the CRM handoff can still add 0, which is
      // exactly what happened before the handoff existed at all. A blind count
      // made that indistinguishable from success.
      const created = res.crm_prospects_created
      if (created === undefined) {
        // Older proxy without the handoff — say only what we can stand behind.
        setBatchMsg(t('confirmedForSdr', { count: ids.length, name }))
      } else {
        const parts = [t('addedToBoard', { created, total: ids.length, name })]
        if (res.crm_prospects_skipped_existing) parts.push(t('alreadyThere', { count: res.crm_prospects_skipped_existing }))
        if (res.crm_prospects_skipped_no_name) parts.push(t('skippedNoName', { count: res.crm_prospects_skipped_no_name }))
        const summary = `${parts.join(' · ')}.`

        // Amber, not green and not a hard error: the confirm itself succeeded
        // and the messages were generated — only the CRM handoff fell short.
        if (res.crm_prospects_error || created < ids.length - (res.crm_prospects_skipped_existing ?? 0) - (res.crm_prospects_skipped_no_name ?? 0)) {
          setBatchWarn(res.crm_prospects_error ? `${summary} ${res.crm_prospects_error}` : summary)
          setBatchMsg(null)
        } else {
          setBatchMsg(summary)
        }
      }
      setSelectedIds(new Set())
      // Re-read so the confirmed rows show their generated messages.
      if (runId) await loadCandidates(runId)
    } catch (e) {
      setError(safeErrorMessage(e, t('genericError')))
    } finally {
      setConfirming(false)
    }
  }

  function openRun(r: BridgeRun) {
    setRunId(r.id)
    setRun(r)
    setTab('search')
    setSelectedIds(new Set())
    setBatchMsg(null)
    loadCandidates(r.id)
  }

  const isRunning = !!runId && !!run && ACTIVE.has(run.status)
  const isFailed = !!run && (run.status === 'failed' || run.status === 'cancelled')
  const shown = filter === 'all' ? candidates : candidates.filter(c => c.verification_status === filter)
  const counts = {
    all: candidates.length,
    pending: candidates.filter(c => c.verification_status === 'pending').length,
    confirmed: candidates.filter(c => c.verification_status === 'confirmed').length,
    rejected: candidates.filter(c => c.verification_status === 'rejected').length,
  }

  // Purely a display grouping — selection/actions below stay per-contact.
  // Grouped by company_id when the backend provided one; older rows (scraped
  // before company_id was persisted) fall back to the company name so they
  // still get a sensible header instead of one group per contact. Only the
  // first 3 contacts per company are shown, per the same-day follow-up spec.
  const groupedShown = useMemo(() => {
    const order: string[] = []
    const groups = new Map<string, { key: string; company: string; companyLinkedinUrl?: string | null; items: BridgeCandidate[] }>()
    for (const c of shown) {
      const key = c.company_id || c.company || '—'
      let group = groups.get(key)
      if (!group) {
        group = { key, company: c.company || t('unknownCompany'), companyLinkedinUrl: c.company_linkedin_url, items: [] }
        groups.set(key, group)
        order.push(key)
      }
      if (!group.companyLinkedinUrl && c.company_linkedin_url) group.companyLinkedinUrl = c.company_linkedin_url
      group.items.push(c)
    }
    return order.map(key => groups.get(key)!)
  }, [shown, t])

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Handshake size={20} color="var(--crm-accent)" />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t('title')}</h1>
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '2px 0 0' }}>
              {t('subtitle')}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('search')} style={tabBtn(tab === 'search')}>{t('tabSearch')}</button>
          <button onClick={() => setTab('history')} style={tabBtn(tab === 'history')}>{t('pastSearches')}</button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430', marginBottom: 16 }}>
          <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', wordBreak: 'break-word' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><X size={14} /></button>
        </div>
      )}

      {/* ══════════ PAST SEARCHES ══════════ */}
      {tab === 'history' && (
        <div style={S.card}>
          <span style={S.label}>{t('pastSearches')}</span>
          {loadingRuns ? (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{tc('loading')}</p>
          ) : runs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{t('noSearchesYet')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {runs.map(r => (
                <button key={r.id} onClick={() => openRun(r)} style={{
                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, gap: 12, padding: '12px 14px', borderRadius: 8,
                  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', minWidth: 130 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>
                    {r.seed_list_name ?? seedLists.find(s => s.id === r.seed_list_id)?.name ?? t('seedListFallback')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                    {t('candidatesCount', { count: r.candidates_found ?? 0 })}
                  </span>
                  <span style={{ ...S.badge, textTransform: 'capitalize' }}>
                    {RUN_STATES.has(r.status) ? t(`runState.${r.status}`) : r.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'search' && (
        <>
          {/* ══════════ A — SEED LISTS ══════════ */}
          <div style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ ...S.label, marginBottom: 0 }}>{t('seedLists')}</span>
              <button onClick={() => { if (showForm) { closeSeedForm() } else { resetForm(); setEditingSeedId(null); setShowForm(true) } }} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                color: '#FFF', backgroundColor: 'var(--crm-accent)', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              }}>
                <Plus size={14} /> {t('newSeedList')}
              </button>
            </div>

            {loadingSeeds ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{tc('loading')}</p>
            ) : seedLists.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{t('noSeedLists')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seedLists.map(sl => {
                  // Counted from the fields the backend actually returns.
                  // Reading `sl.companies` / `sl.criteria` here — the form's
                  // names, never present on a response — is why every row
                  // showed "—" regardless of what the list contained.
                  const nCompanies = sl.company_names?.length ?? 0
                  const nCriteria =
                    (sl.company_headcounts?.length ?? 0) +
                    (sl.geo_codes?.length ?? 0) +
                    (sl.industry_codes?.length ?? 0)
                  return (
                    <div key={sl.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, gap: 12, padding: '11px 14px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)' }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{sl.name}</span>
                      <span style={S.badge}>
                        {CHANNEL_FAMILIES.find(c => c.value === sl.channel_family)?.label ?? String(sl.channel_family)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                        {nCompanies > 0 && t('companiesCount', { count: nCompanies })}
                        {nCompanies > 0 && nCriteria > 0 && ' · '}
                        {nCriteria > 0 && t('criteriaCount', { count: nCriteria })}
                        {nCompanies === 0 && nCriteria === 0 && '—'}
                      </span>
                      <button
                        onClick={() => startEditSeedList(sl)}
                        title={t('editSeedListTooltip')}
                        style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4, flexShrink: 0 }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(sl)}
                        title={t('deleteSeedListTooltip')}
                        style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4, flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Seed list form — creates when editingSeedId is null, edits in
                place otherwise. Header states which, so a preloaded form is
                never mistaken for a blank one. */}
            {showForm && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--crm-border)' }}>
                {editingSeedId && (
                  <div style={{ marginBottom: 12, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--crm-accent)' }}>
                    {t('editingSeedList', { name: name || '—' })}
                  </div>
                )}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>{t('fieldName')}</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder={t('namePlaceholder')} style={S.input} />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>{t('channelFamily')}</label>
                  <select value={channelFamily} onChange={e => setChannelFamily(e.target.value as typeof channelFamily)} style={S.input}>
                    {CHANNEL_FAMILIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>{t('sources')} <span style={{ textTransform: 'none', fontWeight: 400 }}>{t('sourcesHint')}</span></label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setUseCompanies(v => !v)} style={chip(useCompanies)}>{t('sourceCompanies')}</button>
                    <button onClick={() => setUseCriteria(v => !v)} style={chip(useCriteria)}>{t('sourceCriteria')}</button>
                  </div>
                </div>

                {useCompanies && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>{t('companies')} <span style={{ textTransform: 'none', fontWeight: 400 }}>{t('companiesHint')}</span></label>
                    <textarea
                      value={companiesText}
                      onChange={e => setCompaniesText(e.target.value)}
                      rows={5}
                      placeholder={'Acme Corp\nGlobex\nInitech'}
                      style={{ ...S.input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    />
                    {companies.length > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', margin: '6px 0 0' }}>{t('companiesCount', { count: companies.length })}</p>
                    )}
                  </div>
                )}

                {useCriteria && (
                  <div style={{ marginBottom: 14, padding: 14, borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)' }}>
                    <div style={{ marginBottom: 12 }}>
                      <label style={S.label}>{t('industry')}</label>

                      {/* Chips for what's already picked. Selection is by id,
                          so what the user sees and what the actor receives are
                          the same thing — unlike the free-text field this
                          replaced, whose value never left the browser. */}
                      {industryIds.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {industryIds.map(id => (
                            <span key={id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              backgroundColor: '#6C63FF20', color: 'var(--crm-accent)',
                              border: '1px solid #6C63FF40',
                            }}>
                              {INDUSTRY_BY_ID.get(id)?.label ?? `#${id}`}
                              <button
                                onClick={() => setIndustryIds(prev => prev.filter(x => x !== id))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}
                                title={tc('remove')}
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 434 industries is far too many for a <select>, so it's
                          a search box: type, pick, repeat. */}
                      <input
                        value={industryQuery}
                        onChange={e => setIndustryQuery(e.target.value)}
                        placeholder={t('industryPlaceholder')}
                        style={S.input}
                      />
                      {industryQuery.trim() && (
                        <div style={{
                          marginTop: 6, maxHeight: 190, overflowY: 'auto',
                          border: '1px solid var(--crm-border)', borderRadius: 8,
                          backgroundColor: 'var(--crm-surface)',
                        }}>
                          {searchIndustries(industryQuery)
                            .filter(i => !industryIds.includes(i.id))
                            .slice(0, 40)
                            .map(i => (
                              <button
                                key={i.id}
                                onClick={() => { setIndustryIds(prev => [...prev, i.id]); setIndustryQuery('') }}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  padding: '7px 10px', background: 'none', border: 'none',
                                  borderBottom: '1px solid var(--crm-border)', cursor: 'pointer',
                                  color: 'var(--crm-text-primary)', fontSize: 12,
                                }}
                              >
                                {i.label}
                                <span style={{ color: 'var(--crm-text-muted)', fontSize: 10, marginLeft: 6 }}>{i.group}</span>
                              </button>
                            ))}
                          {searchIndustries(industryQuery).filter(i => !industryIds.includes(i.id)).length === 0 && (
                            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--crm-text-muted)' }}>
                              {t('industryNoMatch')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={S.label}>{t('headcount')}</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {HEADCOUNTS.map(h => (
                          <button key={h} onClick={() => toggleHeadcount(h)} style={chip(headcounts.includes(h))}>{h}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>{t('market')}</label>
                      <MarketSelect
                        markets={orgMarkets}
                        loading={marketsLoading}
                        error={marketsError}
                        value={market}
                        onChange={m => setMarket(market === m ? null : m)}
                      />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={saveSeedList} disabled={!canSaveSeed || savingSeed} style={{
                    fontSize: 13, fontWeight: 700, color: '#FFF', border: 'none', borderRadius: 8, padding: '10px 20px',
                    backgroundColor: canSaveSeed && !savingSeed ? 'var(--crm-accent)' : 'var(--crm-border)',
                    cursor: canSaveSeed && !savingSeed ? 'pointer' : 'not-allowed',
                  }}>
                    {savingSeed ? t('saving') : t('saveSeedList')}
                  </button>
                  <button onClick={closeSeedForm} style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--crm-text-muted)', background: 'none',
                    border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 18px', cursor: 'pointer',
                  }}>
                    {tc('cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ══════════ B — RUN SEARCH ══════════ */}
          <div style={S.card}>
            <span style={S.label}>{t('runSearch')}</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={selectedSeedId} onChange={e => setSelectedSeedId(e.target.value)} style={{ ...S.input, flex: 1, minWidth: 240 }}>
                <option value="">{t('selectSeedList')}</option>
                {seedLists.map(sl => <option key={sl.id} value={sl.id}>{sl.name}</option>)}
              </select>
              <button onClick={startRun} disabled={!selectedSeedId || starting || isRunning} style={{
                fontSize: 13, fontWeight: 700, color: '#FFF', border: 'none', borderRadius: 8, padding: '10px 22px',
                backgroundColor: selectedSeedId && !starting && !isRunning ? 'var(--crm-accent)' : 'var(--crm-border)',
                cursor: selectedSeedId && !starting && !isRunning ? 'pointer' : 'not-allowed',
              }}>
                {starting ? t('starting') : t('searchPartnerships')}
              </button>
            </div>

            {/* Progress */}
            {isRunning && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 28 }}>
                <div style={{ position: 'relative', width: 130, height: 130, marginBottom: 20 }}>
                  <svg width="130" height="130" viewBox="0 0 130 130" style={{ animation: 'spin 2s linear infinite' }}>
                    <circle cx="65" cy="65" r="56" fill="none" stroke="var(--crm-border)" strokeWidth="6" />
                    <circle cx="65" cy="65" r="56" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray="300" style={{ animation: 'scraper-ring 1.6s ease-in-out infinite' }} />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: 16 }}>
                    {t(PROGRESS_KEY[run?.status ?? ''] ?? 'progressWorking')}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
                  {t('progressHint')}
                </p>
                {/* The raw log terminal that used to sit here has been removed.
                    It rendered the backend's own debug output verbatim —
                    actor ids, full request payloads, internal field names,
                    stack-trace fragments on failure. None of that means
                    anything to an admin, and all of it is implementation
                    detail we shouldn't be publishing into the product.
                    Diagnostics still exist in full on the server side; this
                    surface now reports progress, which is what the operator
                    actually needs. Mirrors New Run's screen. */}
                {typeof run?.candidates_found === 'number' && run.candidates_found > 0 && (
                  <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--crm-accent)' }}>
                    {t('candidatesSoFar', { count: run.candidates_found })}
                  </p>
                )}
              </div>
            )}

            {isFailed && (
              <p style={{ fontSize: 13, color: '#EF4444', margin: '16px 0 0', textAlign: 'center' }}>
                {run?.status === 'cancelled' ? t('searchCancelled') : t('searchFailed')}
              </p>
            )}

            {!isRunning && run?.status === 'completed' && (
              <p style={{ fontSize: 13, color: '#22C55E', fontWeight: 600, margin: '16px 0 0' }}>
                ✅ {t('candidatesFoundResult', { count: run.candidates_found ?? candidates.length })}
              </p>
            )}
          </div>

          {/* ══════════ C — CANDIDATE REVIEW ══════════ */}
          {runId && !isRunning && !isFailed && (
            <div style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <span style={{ ...S.label, marginBottom: 0 }}>{t('candidateReview')}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([
                    ['all', tc('all'), counts.all],
                    ['pending', t('status.pending'), counts.pending],
                    ['confirmed', t('status.confirmed'), counts.confirmed],
                    ['rejected', t('status.rejected'), counts.rejected],
                  ] as const).map(([key, label, n]) => (
                    <button key={key} onClick={() => setFilter(key as typeof filter)} style={chip(filter === key)}>
                      {label} ({n})
                    </button>
                  ))}
                </div>
              </div>

              {batchMsg && (
                <p style={{ fontSize: 13, color: '#22C55E', fontWeight: 600, margin: '0 0 12px' }}>✅ {batchMsg}</p>
              )}
              {batchWarn && (
                <p style={{ fontSize: 13, color: '#FCD34D', fontWeight: 600, margin: '0 0 12px' }}>⚠️ {batchWarn}</p>
              )}

              {/* Batch action bar — appears once something is selected */}
              {selectedIds.size > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '12px 14px', marginBottom: 14, borderRadius: 10,
                  backgroundColor: '#6C63FF12', border: '1px solid #6C63FF40',
                  position: 'sticky', top: 12, zIndex: 5,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-text-primary)' }}>
                    {t('candidatesSelected', { count: selectedIds.size })}
                  </span>

                  <select value={batchSdrId} onChange={e => setBatchSdrId(e.target.value)} disabled={confirming}
                    style={{ ...S.input, width: 'auto', minWidth: 190, padding: '7px 10px' }}>
                    <option value="">{t('assignToSdr')}</option>
                    {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>

                  <button onClick={confirmBatch} disabled={!batchSdrId || confirming}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#FFF',
                      backgroundColor: !batchSdrId || confirming ? 'var(--crm-border)' : '#22C55E',
                      border: 'none', borderRadius: 8, padding: '9px 18px',
                      cursor: !batchSdrId || confirming ? 'default' : 'pointer',
                    }}>
                    <Check size={14} /> {t('confirmAndSend')}
                  </button>

                  <button onClick={() => setSelectedIds(new Set())} disabled={confirming}
                    style={{ fontSize: 12, color: 'var(--crm-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {t('clear')}
                  </button>

                  {confirming && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                      <span style={{
                        width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
                        border: '2px solid var(--crm-border)', borderTopColor: 'var(--crm-accent)',
                        animation: 'spin .8s linear infinite', display: 'inline-block',
                      }} />
                      {t('generatingMessages', { count: selectedIds.size })}
                    </span>
                  )}
                </div>
              )}

              {loadingCandidates ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{t('loadingCandidates')}</p>
              ) : shown.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                  {candidates.length === 0 ? t('noCandidates') : t('noCandidatesMatchFilter')}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  {groupedShown.map(group => (
                    <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4, gap: 8, paddingBottom: 6, borderBottom: '1px solid var(--crm-border)' }}>
                        <Building2 size={14} color="var(--crm-text-muted)" />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{group.company}</span>
                        <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                          {t('contactsCount', { count: group.items.length })}
                        </span>
                        {group.companyLinkedinUrl && (
                          <a href={group.companyLinkedinUrl} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--crm-accent)', textDecoration: 'none' }}>
                            {t('companyPage')} <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      {/* Three per company by default, but the rest must be
                          REACHABLE. Before this, a company with 8 contacts
                          rendered 3 and the other 5 had no affordance at all —
                          the page reported "9 candidates found" while showing
                          4 rows, which reads as a broken counter rather than a
                          deliberate cap, and hides candidates the org paid to
                          scrape. */}
                      {(expandedGroups.has(group.key) ? group.items : group.items.slice(0, 3)).map(c => {
                    const sc = STATUS_COLORS[c.verification_status] ?? STATUS_COLORS.pending
                    const busy = updating === c.id
                    const isRejected = c.verification_status === 'rejected'
                    const isConfirmed = c.verification_status === 'confirmed'
                    const isPending = !isRejected && !isConfirmed
                    const isSelected = selectedIds.has(c.id)
                    const hasDetail = !!(c.custom1 || c.custom2 || c.assigned_to)
                    const isOpen = expanded.has(c.id)
                    return (
                      <div key={c.id} style={{
                        padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--crm-surface-raised)',
                        border: `1px solid ${isSelected ? '#6C63FF60' : 'var(--crm-border)'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                          {/* Only pending candidates can be batch-confirmed */}
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelected(c.id)}
                              aria-label={t('selectCandidateAria', { name: c.full_name ?? t('candidateFallback') })}
                              style={{ accentColor: 'var(--crm-accent)', width: 16, height: 16, marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 700 }}>{c.full_name || '—'}</span>
                              <span style={{ ...S.badge, backgroundColor: sc.bg, color: sc.color, borderColor: 'transparent', textTransform: 'capitalize' }}>
                                {CANDIDATE_STATES.has(c.verification_status) ? t(`status.${c.verification_status}`) : c.verification_status}
                              </span>
                              {c.linkedin_url && (
                                <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--crm-accent)', textDecoration: 'none' }}>
                                  LinkedIn <ExternalLink size={11} />
                                </a>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)', marginTop: 3 }}>
                              {[c.title, c.company].filter(Boolean).join(' · ') || '—'}
                              {c.location && <span style={{ color: 'var(--crm-text-muted)' }}> · {c.location}</span>}
                            </div>
                            {c.bio && (
                              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>{c.bio}</p>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {isRejected ? (
                              <button onClick={() => setStatus(c, 'pending')} disabled={busy} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                                color: 'var(--crm-text-secondary)', background: 'transparent', border: '1px solid var(--crm-border)',
                                borderRadius: 7, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                              }}>
                                <RotateCcw size={12} /> {t('restore')}
                              </button>
                            ) : (
                              <>
                                {isConfirmed && hasDetail && (
                                  <button onClick={() => toggleExpanded(c.id)} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                                    color: 'var(--crm-text-secondary)', background: 'transparent', border: '1px solid var(--crm-border)',
                                    borderRadius: 7, padding: '6px 12px', cursor: 'pointer',
                                  }}>
                                    {isOpen ? t('hideMessage') : t('viewMessage')}
                                  </button>
                                )}
                                {isPending && (
                                  <button onClick={() => setStatus(c, 'rejected')} disabled={busy} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                                    color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 7, padding: '7px 14px',
                                    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                                  }}>
                                    <Ban size={13} /> {t('reject')}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Confirmed detail: who it went to + the generated messages */}
                        {isConfirmed && isOpen && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--crm-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                              {t('assignedTo')}{' '}
                              <strong style={{ color: 'var(--crm-text-primary)' }}>
                                {sdrs.find(s => s.id === c.assigned_to)?.full_name ?? c.assigned_to ?? '—'}
                              </strong>
                            </div>
                            {/* The message bodies themselves (custom1/custom2) come from the
                                backend already written in the lead's language — only their
                                labels are translated. */}
                            {([['connectionRequest', c.custom1], ['valueMessage', c.custom2]] as const)
                              .filter(([, v]) => !!v)
                              .map(([labelKey, v]) => (
                                <div key={labelKey}>
                                  <div style={{ fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{t(labelKey)}</div>
                                  <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: 'var(--crm-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                    {v}
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )
                      })}
                      {group.items.length > 3 && (
                        <button
                          onClick={() => setExpandedGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })}
                          style={{
                            alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--crm-accent)', fontSize: 12, fontWeight: 600, padding: '2px 0',
                          }}
                        >
                          {expandedGroups.has(group.key)
                            ? t('showFewer')
                            : t('showAllContacts', { count: group.items.length - 3 })}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {deleteTarget && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget && !deletingSeed) setDeleteTarget(null) }}
        >
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t('deleteSeedListTitle', { name: deleteTarget.name })}</h3>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 20 }}>{t('cannotBeUndone')}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deletingSeed}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 13, fontWeight: 600, cursor: deletingSeed ? 'default' : 'pointer' }}
              >
                {tc('cancel')}
              </button>
              <button
                onClick={confirmDeleteSeedList}
                disabled={deletingSeed}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', backgroundColor: '#EF4444', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: deletingSeed ? 'default' : 'pointer', opacity: deletingSeed ? 0.6 : 1 }}
              >
                {deletingSeed ? t('deleting') : tc('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
