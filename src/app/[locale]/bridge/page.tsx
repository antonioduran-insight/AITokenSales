'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  bridgeApi, CHANNEL_FAMILIES, HEADCOUNTS,
  type SeedList, type BridgeRun, type BridgeCandidate, type BridgeLog, type VerificationStatus,
} from '@/lib/bridge-api'
import { Plus, X, ExternalLink, Check, Ban, RotateCcw, AlertCircle, Handshake } from 'lucide-react'

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Global']
const ACTIVE = new Set(['pending', 'running', 'searching'])

const STATUS_LABEL: Record<string, string> = {
  pending: 'Initializing…',
  running: '🔍 Searching companies',
  searching: '🔍 Searching companies',
}

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

export default function BridgePage() {
  const [tab, setTab] = useState<'search' | 'history'>('search')
  const [error, setError] = useState<string | null>(null)

  // ── Seed lists ──
  const [seedLists, setSeedLists] = useState<SeedList[]>([])
  const [loadingSeeds, setLoadingSeeds] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [savingSeed, setSavingSeed] = useState(false)

  // Seed list form — both modes can be combined
  const [name, setName] = useState('')
  const [channelFamily, setChannelFamily] = useState(CHANNEL_FAMILIES[0].value)
  const [useCompanies, setUseCompanies] = useState(true)
  const [useCriteria, setUseCriteria] = useState(false)
  const [companiesText, setCompaniesText] = useState('')
  const [industry, setIndustry] = useState('')
  const [headcounts, setHeadcounts] = useState<string[]>([])
  const [market, setMarket] = useState<string | null>(null)

  // ── Run ──
  const [selectedSeedId, setSelectedSeedId] = useState('')
  const [starting, setStarting] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<BridgeRun | null>(null)
  const [logs, setLogs] = useState<BridgeLog[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Candidates ──
  const [candidates, setCandidates] = useState<BridgeCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [filter, setFilter] = useState<'all' | VerificationStatus>('all')
  const [updating, setUpdating] = useState<string | null>(null)

  // ── History ──
  const [runs, setRuns] = useState<BridgeRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)

  const loadSeedLists = useCallback(async () => {
    setLoadingSeeds(true)
    try { setSeedLists(await bridgeApi.listSeedLists()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoadingSeeds(false) }
  }, [])

  useEffect(() => { loadSeedLists() }, [loadSeedLists])

  const loadCandidates = useCallback(async (id: string) => {
    setLoadingCandidates(true)
    try { setCandidates(await bridgeApi.listCandidates(id)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoadingCandidates(false) }
  }, [])

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    try { setRuns(await bridgeApi.listRuns()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoadingRuns(false) }
  }, [])

  useEffect(() => { if (tab === 'history') loadRuns() }, [tab, loadRuns])

  // ── Poll the active run ──
  const poll = useCallback(async (id: string) => {
    try {
      const [r, l] = await Promise.all([
        bridgeApi.getRun(id),
        bridgeApi.getLogs(id).catch(() => [] as BridgeLog[]),
      ])
      setRun(r)
      setLogs(l)
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
    setCompaniesText(''); setIndustry(''); setHeadcounts([]); setMarket(null)
  }

  const companies = companiesText
    .split(/[\n,]/).map(c => c.trim()).filter(Boolean)

  const canSaveSeed = !!name.trim()
    && (useCompanies || useCriteria)
    && (!useCompanies || companies.length > 0)
    && (!useCriteria || !!industry.trim() || headcounts.length > 0 || !!market)

  async function saveSeedList() {
    if (!canSaveSeed || savingSeed) return
    setSavingSeed(true); setError(null)
    try {
      await bridgeApi.createSeedList({
        name: name.trim(),
        channel_family: channelFamily,
        companies: useCompanies ? companies : [],
        criteria: useCriteria ? {
          industry: industry.trim() || null,
          headcounts,
          market,
        } : null,
      })
      resetForm(); setShowForm(false)
      await loadSeedLists()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSavingSeed(false) }
  }

  async function startRun() {
    if (!selectedSeedId || starting) return
    setStarting(true); setError(null)
    try {
      const res = await bridgeApi.createRun(selectedSeedId)
      const id = res.id ?? res.run_id
      if (!id) throw new Error('Backend did not return a run id')
      setCandidates([]); setLogs([]); setRun(null)
      setRunId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setStarting(false) }
  }

  async function setStatus(c: BridgeCandidate, status: VerificationStatus) {
    setUpdating(c.id); setError(null)
    try {
      await bridgeApi.setCandidateStatus(c.id, status)
      setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, verification_status: status } : x))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setUpdating(null) }
  }

  function openRun(r: BridgeRun) {
    setRunId(r.id)
    setRun(r)
    setTab('search')
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

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Handshake size={20} color="var(--crm-accent)" />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Partnerships</h1>
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '2px 0 0' }}>
              Discover B2B partnership contacts inside target companies.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('search')} style={tabBtn(tab === 'search')}>Search</button>
          <button onClick={() => setTab('history')} style={tabBtn(tab === 'history')}>Past Searches</button>
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
          <span style={S.label}>Past Searches</span>
          {loadingRuns ? (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p>
          ) : runs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>No searches yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {runs.map(r => (
                <button key={r.id} onClick={() => openRun(r)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8,
                  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', minWidth: 130 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>
                    {r.seed_list_name ?? seedLists.find(s => s.id === r.seed_list_id)?.name ?? 'Seed list'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                    {r.candidates_found ?? 0} candidates
                  </span>
                  <span style={{ ...S.badge, textTransform: 'capitalize' }}>{r.status}</span>
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
              <span style={{ ...S.label, marginBottom: 0 }}>Seed Lists</span>
              <button onClick={() => setShowForm(v => !v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                color: '#FFF', backgroundColor: 'var(--crm-accent)', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              }}>
                <Plus size={14} /> New Seed List
              </button>
            </div>

            {loadingSeeds ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p>
            ) : seedLists.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>No seed lists yet — create one to start.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seedLists.map(sl => {
                  const nCompanies = sl.companies?.length ?? 0
                  const crit = sl.criteria
                  const nCriteria = crit ? [crit.industry, crit.market, ...(crit.headcounts ?? [])].filter(Boolean).length : 0
                  return (
                    <div key={sl.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)' }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{sl.name}</span>
                      <span style={S.badge}>
                        {CHANNEL_FAMILIES.find(c => c.value === sl.channel_family)?.label ?? String(sl.channel_family)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                        {nCompanies > 0 && `${nCompanies} companies`}
                        {nCompanies > 0 && nCriteria > 0 && ' · '}
                        {nCriteria > 0 && `${nCriteria} criteria`}
                        {nCompanies === 0 && nCriteria === 0 && '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* New seed list form */}
            {showForm && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--crm-border)' }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Taiwan SaaS resellers" style={S.input} />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Channel Family</label>
                  <select value={channelFamily} onChange={e => setChannelFamily(e.target.value as typeof channelFamily)} style={S.input}>
                    {CHANNEL_FAMILIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Sources <span style={{ textTransform: 'none', fontWeight: 400 }}>(you can combine both)</span></label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setUseCompanies(v => !v)} style={chip(useCompanies)}>Specific companies</button>
                    <button onClick={() => setUseCriteria(v => !v)} style={chip(useCriteria)}>Search criteria</button>
                  </div>
                </div>

                {useCompanies && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>Companies <span style={{ textTransform: 'none', fontWeight: 400 }}>(one per line or comma-separated)</span></label>
                    <textarea
                      value={companiesText}
                      onChange={e => setCompaniesText(e.target.value)}
                      rows={5}
                      placeholder={'Acme Corp\nGlobex\nInitech'}
                      style={{ ...S.input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    />
                    {companies.length > 0 && (
                      <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', margin: '6px 0 0' }}>{companies.length} companies</p>
                    )}
                  </div>
                )}

                {useCriteria && (
                  <div style={{ marginBottom: 14, padding: 14, borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)' }}>
                    <div style={{ marginBottom: 12 }}>
                      <label style={S.label}>Industry</label>
                      <input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Software, Logistics" style={S.input} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={S.label}>Company Headcount</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {HEADCOUNTS.map(h => (
                          <button key={h} onClick={() => toggleHeadcount(h)} style={chip(headcounts.includes(h))}>{h}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={S.label}>Market</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {MARKETS.map(m => (
                          <button key={m} onClick={() => setMarket(market === m ? null : m)} style={chip(market === m)}>{m}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={saveSeedList} disabled={!canSaveSeed || savingSeed} style={{
                    fontSize: 13, fontWeight: 700, color: '#FFF', border: 'none', borderRadius: 8, padding: '10px 20px',
                    backgroundColor: canSaveSeed && !savingSeed ? 'var(--crm-accent)' : 'var(--crm-border)',
                    cursor: canSaveSeed && !savingSeed ? 'pointer' : 'not-allowed',
                  }}>
                    {savingSeed ? 'Saving…' : 'Save Seed List'}
                  </button>
                  <button onClick={() => { setShowForm(false); resetForm() }} style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--crm-text-muted)', background: 'none',
                    border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 18px', cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ══════════ B — RUN SEARCH ══════════ */}
          <div style={S.card}>
            <span style={S.label}>Run Bridge Search</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={selectedSeedId} onChange={e => setSelectedSeedId(e.target.value)} style={{ ...S.input, flex: 1, minWidth: 240 }}>
                <option value="">Select a seed list…</option>
                {seedLists.map(sl => <option key={sl.id} value={sl.id}>{sl.name}</option>)}
              </select>
              <button onClick={startRun} disabled={!selectedSeedId || starting || isRunning} style={{
                fontSize: 13, fontWeight: 700, color: '#FFF', border: 'none', borderRadius: 8, padding: '10px 22px',
                backgroundColor: selectedSeedId && !starting && !isRunning ? 'var(--crm-accent)' : 'var(--crm-border)',
                cursor: selectedSeedId && !starting && !isRunning ? 'pointer' : 'not-allowed',
              }}>
                {starting ? 'Starting…' : 'Search Partnerships'}
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
                    {STATUS_LABEL[run?.status ?? ''] ?? 'Working…'}
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
                  This usually takes a few minutes. You can leave this page — the search keeps running.
                </p>
                {logs.length > 0 && (
                  <div style={{ marginTop: 14, width: '100%', maxWidth: 560, maxHeight: 160, overflowY: 'auto', backgroundColor: '#0D1117', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
                    {logs.map((l, i) => (
                      <div key={l.id ?? i} style={{ color: '#C9D1D9' }}>
                        <span style={{ color: '#52526A', marginRight: 8 }}>{new Date(l.created_at).toLocaleTimeString()}</span>
                        {l.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isFailed && (
              <p style={{ fontSize: 13, color: '#EF4444', margin: '16px 0 0', textAlign: 'center' }}>
                This search {run?.status === 'cancelled' ? 'was cancelled' : 'failed'}. Contact support.
              </p>
            )}

            {!isRunning && run?.status === 'completed' && (
              <p style={{ fontSize: 13, color: '#22C55E', fontWeight: 600, margin: '16px 0 0' }}>
                ✅ {run.candidates_found ?? candidates.length} candidates found
              </p>
            )}
          </div>

          {/* ══════════ C — CANDIDATE REVIEW ══════════ */}
          {runId && !isRunning && !isFailed && (
            <div style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <span style={{ ...S.label, marginBottom: 0 }}>Candidate Review</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([
                    ['all', 'All', counts.all],
                    ['pending', 'Pending', counts.pending],
                    ['confirmed', 'Confirmed', counts.confirmed],
                    ['rejected', 'Rejected', counts.rejected],
                  ] as const).map(([key, label, n]) => (
                    <button key={key} onClick={() => setFilter(key as typeof filter)} style={chip(filter === key)}>
                      {label} ({n})
                    </button>
                  ))}
                </div>
              </div>

              {loadingCandidates ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading candidates…</p>
              ) : shown.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                  {candidates.length === 0 ? 'No candidates for this search.' : 'No candidates match this filter.'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {shown.map(c => {
                    const sc = STATUS_COLORS[c.verification_status] ?? STATUS_COLORS.pending
                    const busy = updating === c.id
                    const isRejected = c.verification_status === 'rejected'
                    return (
                      <div key={c.id} style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 700 }}>{c.full_name || '—'}</span>
                              <span style={{ ...S.badge, backgroundColor: sc.bg, color: sc.color, borderColor: 'transparent', textTransform: 'capitalize' }}>
                                {c.verification_status}
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
                                <RotateCcw size={12} /> Restore
                              </button>
                            ) : (
                              <>
                                <button onClick={() => setStatus(c, 'confirmed')} disabled={busy || c.verification_status === 'confirmed'} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                                  color: '#FFF', backgroundColor: '#22C55E', border: 'none', borderRadius: 7, padding: '7px 14px',
                                  cursor: busy || c.verification_status === 'confirmed' ? 'default' : 'pointer',
                                  opacity: busy || c.verification_status === 'confirmed' ? 0.45 : 1,
                                }}>
                                  <Check size={13} /> Confirm
                                </button>
                                <button onClick={() => setStatus(c, 'rejected')} disabled={busy} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
                                  color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 7, padding: '7px 14px',
                                  cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                                }}>
                                  <Ban size={13} /> Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
