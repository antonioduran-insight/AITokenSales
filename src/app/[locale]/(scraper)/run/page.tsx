'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Minus, Plus, AlertCircle, XCircle } from 'lucide-react'
import type { User, ScraperComboMaster, AreaName } from '@/lib/types'
import { areaLabel } from '@/lib/utils/area-inference'
import { useOrgMarkets } from '@/lib/hooks/useOrgMarkets'
import { RegionMarketSelect } from '@/components/markets/RegionMarketSelect'

// An SDR row plus the flattened set of area names it covers (primary area_id +
// any user_areas), used to filter the SDR list by the selected market.
type SdrOption = User & { areaNames: string[] }

const MAX_INT = 2147483647
const STEP = 10
const MIN_LEADS = 10
const MAX_LEADS = 500
const PRESETS = [100, 200, 300, 400, 500]
const STORAGE_KEY = 'scraper_active_run'

const ACTIVE = new Set(['pending', 'running', 'scraping', 'scoring', 'drafting'])

// Backend status → simple centered label for Phase 2
const STATUS_LABEL: Record<string, string> = {
  pending: 'Initializing…',
  running: 'Initializing…',
  scraping: '🔍 Scraping LinkedIn',
  scoring: '📊 Scoring leads',
  drafting: '✍️ Generating messages',
}

// Which of the 4 progress dots is "active" for a given status
const STATUS_STEP: Record<string, number> = {
  pending: 0, running: 0, scraping: 0, scoring: 1, drafting: 2, completed: 3,
}
const STEPS = ['Scraping', 'Scoring', 'Messages', 'Done']

const CSV_COLUMNS = ['full_name', 'company', 'title', 'linkedin_url', 'location', 'icp_score', 'temperature', 'search_combo', 'market', 'custom1', 'custom2'] as const

interface RunSummary {
  status: string
  market: string
  markets?: string[]
  region?: string | null
  total_leads_requested: number
  leads_generated: number
  /** Set by the backend when the run fails — surfaced verbatim in the UI. */
  error_message?: string | null
  temperature: { HOT: number; WARM: number; COLD: number }
  run_sdr_assignments?: Array<{ sdr_id: string; leads_assigned: number; user?: { full_name: string } }>
}

const S: Record<string, React.CSSProperties> = {
  page:  { padding: '32px 24px', color: 'var(--crm-text-primary)', maxWidth: 680, margin: '0 auto' },
  card:  { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px' },
  label: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 12 },
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '10px 22px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : 'var(--crm-text-secondary)',
    transition: 'all .15s',
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

async function downloadRunCsv(runId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('scraper_leads').select('*').eq('run_id', runId).limit(500)
  const rows = data ?? []
  const header = CSV_COLUMNS.join(',')
  const body = rows.map(r => CSV_COLUMNS.map(c => csvEscape((r as Record<string, unknown>)[c])).join(',')).join('\n')
  const blob = new Blob([[header, body].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `run_${runId.slice(0, 8)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function RunPageInner() {
  const router = useRouter()
  const locale = useLocale()
  const searchParams = useSearchParams()

  // ── Phase state ──
  const [runId, setRunId] = useState<string | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [assignState, setAssignState] = useState<'idle' | 'assigning' | 'done'>('idle')
  // Set when the run's status can't be read at all (404/403, or repeated
  // network failures). Without this the screen sat on "Initializing…" forever.
  const [pollError, setPollError] = useState<string | null>(null)
  const assignFiredRef = useRef(false)
  const pollFailuresRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Phase 1: config ──
  const { markets: orgMarkets, loading: marketsLoading, error: marketsError } = useOrgMarkets()
  // A run targets exactly one region; the admin then picks which of that
  // region's activated countries to include (all preselected by default).
  const [region, setRegion] = useState<AreaName | null>(null)
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([])
  // Tracks which region we've already auto-selected "all countries" for, so a
  // manual uncheck isn't clobbered by a late-arriving markets fetch.
  const autoAppliedRegionRef = useRef<AreaName | null>(null)
  const [activeCombos, setActiveCombos] = useState<ScraperComboMaster[]>([])
  const [combosLoading, setCombosLoading] = useState(true)
  const [selectedCombos, setSelectedCombos] = useState<string[]>([])
  const [totalLeads, setTotalLeads] = useState(100)
  const [available, setAvailable] = useState(MAX_INT)
  const [unlimited, setUnlimited] = useState(true)
  const [sdrs, setSdrs] = useState<SdrOption[]>([])
  // Exactly ONE SDR per run — every generated lead goes to them.
  const [selectedSdrId, setSelectedSdrId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Kept for the auto-assign call after completion (survives restore)
  const runMetaRef = useRef<{ markets: string[]; sdrId: string | null }>({ markets: [], sdrId: null })

  const effectiveMax = unlimited ? MAX_LEADS : Math.min(MAX_LEADS, available)
  const overLimit = !unlimited && totalLeads > available

  const canRun = !!region && selectedMarkets.length > 0 && selectedCombos.length > 0 &&
    totalLeads >= MIN_LEADS && !!selectedSdrId && !overLimit

  // ── Load combos + quota ──
  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => setActiveCombos(Array.isArray(data) ? data.filter(c => c.org_active) : []))
      .catch(() => {})
      .finally(() => setCombosLoading(false))

    fetch('/api/runs/quota')
      .then(r => r.json())
      .then(q => {
        if (typeof q.available === 'number') setAvailable(q.available)
        if (typeof q.unlimited === 'boolean') setUnlimited(q.unlimited)
      })
      .catch(() => {})
  }, [])

  // Default to "all activated countries in this region" once the org's
  // markets have loaded. Guarded so a manual uncheck by the admin isn't
  // overwritten by a markets fetch that resolves after the click.
  useEffect(() => {
    if (!region || marketsLoading) return
    if (autoAppliedRegionRef.current === region) return
    setSelectedMarkets(orgMarkets.filter(m => m.region === region).map(m => m.name))
    autoAppliedRegionRef.current = region
  }, [region, marketsLoading, orgMarkets])

  // ── Load SDRs + the areas they cover ──
  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      // scraper_access is no longer a concept — any active SDR can receive a run.
      supabase.from('users').select('*').eq('role', 'sdr').eq('is_active', true),
      supabase.from('areas').select('id, name'),
      supabase.from('user_areas').select('user_id, area_id'),
    ]).then(([usersRes, areasRes, uaRes]) => {
      const users = (usersRes.data ?? []) as User[]
      const areaName = new Map<string, string>(
        ((areasRes.data ?? []) as Array<{ id: string; name: string }>).map(a => [a.id, a.name])
      )
      const areasByUser = new Map<string, string[]>()
      for (const ua of (uaRes.data ?? []) as Array<{ user_id: string; area_id: string }>) {
        const list = areasByUser.get(ua.user_id) ?? []
        list.push(ua.area_id)
        areasByUser.set(ua.user_id, list)
      }
      setSdrs(users.map(u => {
        const names = new Set<string>()
        if (u.area_id && areaName.has(u.area_id)) names.add(areaName.get(u.area_id)!)
        for (const aid of areasByUser.get(u.id) ?? []) if (areaName.has(aid)) names.add(areaName.get(aid)!)
        return { ...u, areaNames: [...names] }
      }))
    })
  }, [])

  // ── Restore an in-progress run when returning to the page ──
  useEffect(() => {
    const fromQuery = searchParams.get('run')
    let stored: { runId: string; markets?: string[]; sdrId: string | null } | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) stored = JSON.parse(raw)
    } catch { /* ignore */ }

    const id = fromQuery ?? stored?.runId ?? null
    if (!id) return
    runMetaRef.current = {
      markets: stored?.markets ?? [],
      sdrId: stored?.sdrId ?? null,
    }
    setRunId(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SDR eligibility is by REGION, not by the individual countries picked
  // within it — the region is chosen explicitly, so no inference is needed.
  const visibleSdrs = region ? sdrs.filter(s => s.areaNames.includes(region)) : sdrs

  // ── Auto-assign once the run completes (idempotent) ──
  // Every lead of the run goes to the single SDR picked in Phase 1.
  const runAssign = useCallback(async (id: string) => {
    const meta = runMetaRef.current
    if (!meta.sdrId) { setAssignState('done'); return }
    setAssignState('assigning')
    try {
      await fetch(`/api/runs/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdr_id: meta.sdrId,
          markets: meta.markets,
        }),
      })
    } catch { /* the exported flag keeps this safe on retry */ }
    // Re-fetch the final summary (now with per-SDR counts)
    try {
      const res = await fetch(`/api/runs/${id}`)
      if (res.ok) setSummary(await res.json())
    } catch { /* ignore */ }
    setAssignState('done')
  }, [])

  // ── Poll the run while it's active ──
  const poll = useCallback(async (id: string) => {
    const stopPolling = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }

    let data: RunSummary
    try {
      const res = await fetch(`/api/runs/${id}`)
      if (!res.ok) {
        // Never swallow this: a persistently failing status read used to leave
        // the screen on "Initializing…" forever with no feedback.
        const body = await res.json().catch(() => ({}))
        const msg = typeof body?.error === 'string' ? body.error : `Status request failed (${res.status})`
        pollFailuresRef.current += 1
        if (res.status === 404 || res.status === 403 || pollFailuresRef.current >= 3) {
          stopPolling()
          setPollError(msg)
        }
        return
      }
      data = await res.json()
    } catch (e) {
      pollFailuresRef.current += 1
      if (pollFailuresRef.current >= 3) {
        stopPolling()
        setPollError(e instanceof Error ? e.message : 'Could not reach the server')
      }
      return
    }

    pollFailuresRef.current = 0
    setPollError(null)
    setSummary(data)

    try {
      if (!ACTIVE.has(data.status)) {
        stopPolling()
        // Only a successful run clears the persisted pointer. A failed or
        // cancelled run keeps it so reloading the page still shows the error
        // instead of dropping the user back on an empty form.
        if (data.status === 'completed') {
          try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
        }
        if (data.status === 'completed' && !assignFiredRef.current) {
          assignFiredRef.current = true
          // Always run the assign. We must NOT use run_sdr_assignments as proof
          // that leads were pushed to the CRM: the Railway backend writes those
          // rows itself when the run finishes, which used to make us skip the
          // assign entirely — the leads never reached prospects. The endpoint is
          // idempotent (it skips leads the SDR already has), so calling it is safe.
          await runAssign(id)
        }
      }
    } catch { /* transient */ }
  }, [runAssign])

  useEffect(() => {
    if (!runId) return
    poll(runId)
    pollRef.current = setInterval(() => poll(runId), 3000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // ── Config actions ──
  function selectRegion(r: AreaName) {
    setRegion(r)
    // Force the auto-select effect to re-run for the newly chosen region.
    autoAppliedRegionRef.current = null
    setSelectedSdrId(null)
    setSubmitError(null)
  }
  function toggleMarket(name: string) {
    setSelectedMarkets(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }
  function toggleCombo(code: string) {
    setSelectedCombos(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
    setSubmitError(null)
  }
  function setLeads(v: number) {
    let x = v
    if (x < MIN_LEADS) x = MIN_LEADS
    if (x > MAX_LEADS) x = MAX_LEADS
    setTotalLeads(x)
  }

  async function handleRun() {
    if (!canRun || submitting || !selectedSdrId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets: selectedMarkets,
          region,
          combos: selectedCombos,
          total_leads: totalLeads,
          // One SDR per run — every generated lead goes to them.
          sdr_id: selectedSdrId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(typeof data.error === 'string' ? data.error : JSON.stringify(data))
        return
      }
      runMetaRef.current = { markets: selectedMarkets, sdrId: selectedSdrId }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ runId: data.run_id, markets: selectedMarkets, sdrId: selectedSdrId }))
      } catch { /* ignore */ }
      assignFiredRef.current = false
      pollFailuresRef.current = 0
      setPollError(null)
      setSummary(null)
      setAssignState('idle')
      setRunId(data.run_id)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function resetToConfig() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    assignFiredRef.current = false
    pollFailuresRef.current = 0
    setPollError(null)
    setRunId(null)
    setSummary(null)
    setAssignState('idle')
    setRegion(null)
    setSelectedMarkets([])
    autoAppliedRegionRef.current = null
    setSelectedCombos([])
    setSelectedSdrId(null)
    setSubmitError(null)
    setCancelling(false)
    // Clear the ?run= query param if present
    router.replace(`/${locale}/run`)
  }

  // Cancel the in-progress run. The poll then picks up the 'cancelled' status.
  async function handleCancel() {
    if (!runId || cancelling) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' })
      if (res.ok) {
        setSummary(prev => (prev ? { ...prev, status: 'cancelled' } : { status: 'cancelled' } as RunSummary))
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    finally { setCancelling(false) }
  }

  // ── Derived phase ──
  const status = summary?.status ?? 'pending'
  const isConfig = !runId
  // A failed status OR an unreadable status both end the progress screen —
  // otherwise an unknown/unreachable run sits on "Initializing…" indefinitely.
  const isFailed = !!runId && (status === 'failed' || !!pollError)
  const isCancelled = !!runId && !isFailed && status === 'cancelled'
  const isRunning = !!runId && !isFailed && !isCancelled &&
    (ACTIVE.has(status) || (status === 'completed' && assignState !== 'done'))
  const isCompleted = !!runId && !isFailed && status === 'completed' && assignState === 'done'

  // Prefer the backend's own explanation, then the status-read failure.
  const failureDetail = summary?.error_message?.trim() || pollError || null

  // ══════════════════════════════════════════
  return (
    <div style={S.page}>
      {/* ══════════ PHASE 1 — CONFIG ══════════ */}
      {isConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>New Run</h1>
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: '6px 0 0' }}>
              {unlimited ? 'Unlimited leads available this month' : `${available.toLocaleString()} leads available this month`}
            </p>
          </div>

          {/* Market — pick a region, then which of its activated countries to include */}
          <div style={S.card}>
            <span style={S.label}>Market</span>
            <RegionMarketSelect
              markets={orgMarkets}
              loading={marketsLoading}
              error={marketsError}
              region={region}
              onRegionChange={selectRegion}
              selectedMarkets={selectedMarkets}
              onToggleMarket={toggleMarket}
            />
          </div>

          {/* Combos */}
          <div style={S.card}>
            <span style={S.label}>Search Strategy</span>
            {combosLoading ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p>
            ) : activeCombos.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                No active search strategies. Enable them in Settings → Scraper.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {activeCombos.map(c => {
                  const active = selectedCombos.includes(c.code)
                  return (
                    <button key={c.code} onClick={() => toggleCombo(c.code)} style={{
                      padding: '11px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left' as const,
                      border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
                      backgroundColor: active ? '#6C63FF15' : 'var(--crm-surface-raised)',
                      color: active ? 'var(--crm-accent)' : 'var(--crm-text-secondary)', transition: 'all .15s',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                        {active && <span style={{ marginRight: 4 }}>✓</span>}{c.name}
                      </div>
                      {c.description && <div style={{ fontSize: 11, opacity: 0.7 }}>{c.description}</div>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Total leads */}
          <div style={S.card}>
            <span style={S.label}>Total Leads</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {PRESETS.map(p => (
                <button key={p} onClick={() => setLeads(p)}
                  disabled={!unlimited && p > available}
                  style={{ ...chip(totalLeads === p), padding: '8px 16px', fontSize: 13,
                    opacity: (!unlimited && p > available) ? 0.35 : 1,
                    cursor: (!unlimited && p > available) ? 'not-allowed' : 'pointer' }}>
                  {p}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setLeads(totalLeads - STEP)} disabled={totalLeads <= MIN_LEADS}
                style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', cursor: totalLeads <= MIN_LEADS ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: totalLeads <= MIN_LEADS ? 0.4 : 1 }}>
                <Minus size={16} />
              </button>
              <input value={totalLeads}
                onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); setTotalLeads(Number.isNaN(n) ? 0 : n) }}
                onBlur={() => setLeads(totalLeads)}
                inputMode="numeric"
                style={{ width: 120, textAlign: 'center', padding: '10px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 18, fontWeight: 700, fontFamily: 'monospace', outline: 'none' }} />
              <button onClick={() => setLeads(totalLeads + STEP)} disabled={totalLeads >= effectiveMax}
                style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', cursor: totalLeads >= effectiveMax ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: totalLeads >= effectiveMax ? 0.4 : 1 }}>
                <Plus size={16} />
              </button>
            </div>
            {!unlimited && (
              <p style={{ fontSize: 12, color: overLimit ? '#EF4444' : 'var(--crm-text-muted)', margin: '12px 0 0' }}>
                {overLimit
                  ? `Only ${available.toLocaleString()} leads left this billing period — lower the total to continue.`
                  : <>{available.toLocaleString()} leads available this billing period</>}
              </p>
            )}
          </div>

          {/* SDR — a single recipient; every lead this run generates goes to them */}
          {region && (
            <div style={S.card}>
              <span style={S.label}>Assign to SDR</span>
              {visibleSdrs.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                  No SDRs are assigned to {areaLabel(region)}. Assign an area to an SDR in Settings → Users.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibleSdrs.map(sdr => {
                    const sel = selectedSdrId === sdr.id
                    return (
                      <label key={sdr.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, cursor: 'pointer',
                        backgroundColor: sel ? '#6C63FF10' : 'var(--crm-surface-raised)',
                        border: `1px solid ${sel ? '#6C63FF40' : 'var(--crm-border)'}`, transition: 'all .15s',
                      }}>
                        <input type="radio" name="sdr" checked={sel} onChange={() => setSelectedSdrId(sdr.id)}
                          style={{ accentColor: 'var(--crm-accent)', width: 15, height: 15 }} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>{sdr.areaNames.join(', ') || '—'}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              {selectedSdrId && (
                <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '12px 0 0' }}>
                  {totalLeads} leads → {sdrs.find(s => s.id === selectedSdrId)?.full_name ?? '?'}
                </p>
              )}
            </div>
          )}

          {submitError && (
            <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
              <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>Could not start the run</p>
                <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' as const }}>{submitError}</p>
              </div>
            </div>
          )}

          <button onClick={handleRun} disabled={!canRun || submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, backgroundColor: canRun && !submitting ? 'var(--crm-accent)' : 'var(--crm-border)', color: '#FFF', cursor: canRun && !submitting ? 'pointer' : 'not-allowed', transition: 'all .15s' }}>
            {submitting ? 'Starting…' : overLimit ? 'Monthly limit reached' : 'Run Scraping'}
          </button>
        </div>
      )}

      {/* ══════════ PHASE 2 — PROGRESS ══════════ */}
      {isRunning && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
          <div style={{ position: 'relative', width: 160, height: 160, marginBottom: 32 }}>
            <svg width="160" height="160" viewBox="0 0 160 160" style={{ animation: 'spin 2s linear infinite' }}>
              <circle cx="80" cy="80" r="70" fill="none" stroke="var(--crm-border)" strokeWidth="6" />
              <circle cx="80" cy="80" r="70" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray="300" style={{ animation: 'scraper-ring 1.6s ease-in-out infinite' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 15, fontWeight: 700, padding: 20 }}>
              {assignState === 'assigning' ? 'Distributing leads to SDRs…' : (STATUS_LABEL[status] ?? 'Working…')}
            </div>
          </div>

          {/* 4-dot progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
            {STEPS.map((label, i) => {
              const cur = STATUS_STEP[status] ?? 0
              const color = i < cur ? '#22C55E' : i === cur ? 'var(--accent)' : 'var(--crm-border)'
              const textColor = i <= cur ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)'
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 76 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: color, transition: 'all .3s' }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: textColor }}>{label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span style={{ width: 24, height: 2, backgroundColor: i < cur ? '#22C55E' : 'var(--crm-border)', marginBottom: 18 }} />
                  )}
                </div>
              )
            })}
          </div>

          <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
            This usually takes 2–5 minutes. Do not close this tab — but if you do, we&apos;ll keep working in the background.
          </p>
          {summary && summary.leads_generated > 0 && (
            <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', marginTop: 10 }}>
              {summary.leads_generated} / {summary.total_leads_requested} leads so far
            </p>
          )}

          {assignState !== 'assigning' && (
            <button onClick={handleCancel} disabled={cancelling}
              style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 8, padding: '9px 18px', cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.5 : 1 }}>
              <XCircle size={14} /> {cancelling ? 'Cancelling…' : 'Cancel run'}
            </button>
          )}
        </div>
      )}

      {/* ══════════ CANCELLED ══════════ */}
      {isCancelled && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', backgroundColor: 'var(--crm-surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <XCircle size={44} color="var(--crm-text-muted)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Run cancelled</h2>
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0, textAlign: 'center' }}>This run was stopped before it finished.</p>
          <button onClick={resetToConfig}
            style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 22px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
            New Run
          </button>
        </div>
      )}

      {/* ══════════ PHASE 3 — RESULT ══════════ */}
      {isCompleted && summary && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', backgroundColor: '#22C55E20', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, animation: 'scraper-pop .5s ease-out' }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px', textAlign: 'center' }}>
            ✅ Run Complete
          </h2>
          <p style={{ fontSize: 14, color: 'var(--crm-text-secondary)', margin: '0 0 28px', textAlign: 'center' }}>
            {summary.leads_generated} leads generated across {(summary.markets?.length ? summary.markets : [summary.market]).join(', ')}
          </p>

          {/* Temperature cards */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 28, width: '100%', maxWidth: 420 }}>
            {[
              { key: 'HOT', emoji: '🔥', label: 'Hot', color: '#F87171', n: summary.temperature.HOT },
              { key: 'WARM', emoji: '🌡️', label: 'Warm', color: '#FBBF24', n: summary.temperature.WARM },
              { key: 'COLD', emoji: '❄️', label: 'Cold', color: '#60A5FA', n: summary.temperature.COLD },
            ].map(t => (
              <div key={t.key} style={{ flex: 1, ...S.card, padding: '16px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{t.emoji}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: t.color, fontFamily: 'monospace' }}>{t.n}</div>
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{t.label}</div>
              </div>
            ))}
          </div>

          {/* The single SDR this run was assigned to */}
          {(() => {
            // run_sdr_assignments always holds this run's single SDR (inserted
            // when the run is created), joined with the user's name.
            const a = (summary.run_sdr_assignments ?? [])[0]
            const name = a?.user?.full_name ?? sdrs.find(s => s.id === a?.sdr_id)?.full_name
            if (!name) return null
            return (
              <div style={{ ...S.card, width: '100%', maxWidth: 420, marginBottom: 28, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Assigned to</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)', marginTop: 4 }}>
                  {a?.leads_assigned ?? summary.leads_generated} leads
                </div>
              </div>
            )
          })()}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => router.push(`/${locale}/history?run=${runId}`)}
              style={{ fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 20px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
              View Detailed
            </button>
            <button onClick={() => runId && downloadRunCsv(runId)}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', backgroundColor: 'transparent', padding: '11px 20px', borderRadius: 9, border: '1px solid var(--crm-border)', cursor: 'pointer' }}>
              Download CSV
            </button>
            <button onClick={resetToConfig}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-muted)', background: 'none', padding: '11px 16px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
              New Run
            </button>
          </div>
        </div>
      )}

      {/* ══════════ PHASE 3 — FAILURE ══════════ */}
      {isFailed && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 60 }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', backgroundColor: '#EF444420', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>This run failed</h2>

          {failureDetail ? (
            <div style={{ width: '100%', maxWidth: 520, marginTop: 4 }}>
              <div style={{ backgroundColor: '#EF444410', border: '1px solid #EF444430', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 11, color: '#EF4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Error</p>
                <p style={{ fontSize: 12.5, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {failureDetail}
                </p>
              </div>
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0', textAlign: 'center' }}>
                If this keeps happening, send this message to support.
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0, textAlign: 'center' }}>
              No error details were reported. Contact support.
            </p>
          )}

          <button onClick={resetToConfig}
            style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 22px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}

export default function RunPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--crm-text-muted)', padding: 40 }}>Loading…</p>}>
      <RunPageInner />
    </Suspense>
  )
}
