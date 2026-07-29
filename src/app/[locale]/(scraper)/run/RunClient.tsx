'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Minus, Plus, AlertCircle, XCircle, Loader2 } from 'lucide-react'
import type { User, ScraperComboMaster, AreaName } from '@/lib/types'
import { areaLabel } from '@/lib/utils/area-inference'
import { useOrgMarkets } from '@/lib/hooks/useOrgMarkets'
import { useComboMeta } from '@/lib/hooks/useComboLabels'
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
// A run that's genuinely still active never takes anywhere near this long
// (Phase 2's own copy says "usually takes 2-5 minutes") — this is a generous
// upper bound before a restored pointer is treated as stale, not a realistic
// runtime estimate. Anything older is ignored outright, regardless of phase
// (running, completed, or failed) — this is what stops New Run from
// resurrecting a days-old run's state with zero explicit action from the user.
const MAX_RESTORE_AGE_MS = 60 * 60 * 1000

// The backend only ever reports 'pending' -> 'running' -> 'completed'/'failed'
// (it never emits intermediate scraping/scoring/drafting states, despite the
// enum allowing for them) — so the UI only shows what's actually real: a
// single "in progress" state, not fabricated sub-steps.
const ACTIVE = new Set(['pending', 'running'])

// Backend status → the `run` message key for Phase 2's centered label. The keys
// are resolved at render time (not baked in as English strings) so the label
// follows the user's locale.
const STATUS_KEY: Record<string, string> = {
  pending: 'statusPending',
  running: 'statusRunning',
}

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
  const t = useTranslations('run')
  // Reused rather than duplicated into `run`: generic verbs live in `common`,
  // the HOT/WARM/COLD labels in `temperature`, "Download CSV" in `export`.
  const tCommon = useTranslations('common')
  const tTemp = useTranslations('temperature')
  const tExport = useTranslations('export')

  // ── Phase state ──
  const [runId, setRunId] = useState<string | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [assignState, setAssignState] = useState<'idle' | 'assigning' | 'done'>('idle')
  // Authoritative failure to read this run at all: 404 (run doesn't exist /
  // isn't ours) or 403 (lost access). These stop polling for good and route
  // to the failure screen — there's nothing to wait out.
  const [pollError, setPollError] = useState<string | null>(null)
  // Transient status-read failures (network blip, backend redeploy, 5xx).
  // These do NOT stop polling and do NOT route to the failure screen — a
  // Railway redeploy can take minutes, and treating that gap as "the run
  // failed" used to make the user hit "Try Again", which wiped the
  // localStorage pointer while the run went on to complete successfully in
  // the background with nothing left to catch it. We just keep polling and
  // show a soft "reconnecting" indicator instead.
  const [reconnecting, setReconnecting] = useState(false)
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
  // Translated combo name/description, keyed by code. The hook is the source of
  // the DISPLAY COPY only — it deliberately doesn't carry `org_active`, so the
  // fetch above stays the source of truth for WHICH combos this org may pick
  // and in what catalogue order.
  const combosMeta = useComboMeta()
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

  // The pickable combo cards: org-activated combos in catalogue order (from the
  // fetch), each with its localized name/description (from `useComboMeta`).
  // `code` is what the picker toggles and what POST /api/runs receives — the
  // translated name is never sent to the backend.
  const comboCards = useMemo(() => {
    const meta = new Map(combosMeta.map(m => [m.code, m]))
    return activeCombos.map(c => ({
      code: c.code,
      name: meta.get(c.code)?.name ?? c.name,
      description: meta.get(c.code)?.description ?? c.description ?? '',
    }))
  }, [activeCombos, combosMeta])

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
    let stored: { runId: string; markets?: string[]; sdrId: string | null; startedAt?: number } | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) stored = JSON.parse(raw)
    } catch { /* ignore */ }

    // An explicit ?run= link (e.g. from History) always wins, no matter its
    // age — the user asked to see that specific run. The localStorage
    // pointer is an *implicit* restore, so it's the only one that needs a
    // staleness check: with no age at all (older entries never had one) or
    // older than MAX_RESTORE_AGE_MS, drop it and clean it up rather than
    // resurrecting a run's status (running, completed, or failed) that the
    // user never asked to see again.
    if (!fromQuery && stored) {
      const age = Date.now() - (stored.startedAt ?? 0)
      if (!stored.startedAt || age > MAX_RESTORE_AGE_MS) {
        try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
        stored = null
      }
    }

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
  // Every lead of the run goes to the single SDR picked in Phase 1. `data` is
  // the freshly-polled run, used as a fallback source of truth: if the local
  // in-memory/localStorage pointer is gone (tab was closed and reopened days
  // later, or a second run overwrote the single localStorage slot), the SDR
  // and markets are still recoverable from run_sdr_assignments — the row the
  // server wrote when the run was created — so this isn't purely
  // client-memory-dependent.
  const runAssign = useCallback(async (id: string, data: RunSummary) => {
    const meta = runMetaRef.current
    const serverAssignment = data.run_sdr_assignments?.[0]
    const sdrId = meta.sdrId ?? serverAssignment?.sdr_id ?? null
    if (!sdrId) { setAssignState('done'); return }
    const markets = meta.markets.length > 0
      ? meta.markets
      : (data.markets?.length ? data.markets : (data.market ? [data.market] : []))
    setAssignState('assigning')
    try {
      await fetch(`/api/runs/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdr_id: sdrId, markets }),
      })
    } catch { /* the assignFiredRef guard is per-mount only — a retry on next poll cycle isn't automatic, but revisiting this page is (see fallback above) */ }
    // Re-fetch the final summary (now with per-SDR counts)
    try {
      const res = await fetch(`/api/runs/${id}`)
      if (res.ok) setSummary(await res.json())
    } catch { /* ignore */ }
    setAssignState('done')
  }, [])

  // ── Poll the run while it's active ──
  const poll = useCallback(async (id: string) => {
    let data: RunSummary
    try {
      const res = await fetch(`/api/runs/${id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // A backend-supplied `error` is surfaced verbatim (it's a diagnostic
        // string, not UI copy); only our own fallback wording is localized.
        const msg = typeof body?.error === 'string'
          ? body.error
          : t('statusRequestFailed', { status: String(res.status) })
        if (res.status === 404 || res.status === 403) {
          // Authoritative: the run doesn't exist or we lost access. Nothing to
          // wait out — stop for real and show the failure screen.
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setReconnecting(false)
          setPollError(msg)
          return
        }
        // Transient (5xx, gateway errors during a backend redeploy, etc.).
        // Keep polling — do NOT stop, do NOT touch localStorage, do NOT show
        // the failure screen. The run may complete on the backend while we're
        // in this gap; when it does, the next successful poll picks it up.
        pollFailuresRef.current += 1
        if (pollFailuresRef.current >= 3) setReconnecting(true)
        return
      }
      data = await res.json()
    } catch {
      pollFailuresRef.current += 1
      if (pollFailuresRef.current >= 3) setReconnecting(true)
      return
    }

    pollFailuresRef.current = 0
    setReconnecting(false)
    setPollError(null)
    setSummary(data)

    try {
      if (!ACTIVE.has(data.status)) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
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
          await runAssign(id, data)
        }
      }
    } catch { /* transient */ }
  }, [runAssign, t])

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ runId: data.run_id, markets: selectedMarkets, sdrId: selectedSdrId, startedAt: Date.now() }))
      } catch { /* ignore */ }
      assignFiredRef.current = false
      pollFailuresRef.current = 0
      setPollError(null)
      setReconnecting(false)
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
    setReconnecting(false)
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
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{t('title')}</h1>
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: '6px 0 0' }}>
              {unlimited ? t('quotaUnlimited') : t('quotaAvailable', { count: available })}
            </p>
          </div>

          {/* Market — pick a region, then which of its activated countries to include */}
          <div style={S.card}>
            <span style={S.label}>{t('sectionMarket')}</span>
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
            <span style={S.label}>{t('sectionSearchStrategy')}</span>
            {combosLoading ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{tCommon('loading')}</p>
            ) : comboCards.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                {t('noCombos')}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {comboCards.map(c => {
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
            <span style={S.label}>{t('sectionTotalLeads')}</span>
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
                  ? t('overLimit', { count: available })
                  : t('quotaBillingPeriod', { count: available })}
              </p>
            )}
          </div>

          {/* SDR — a single recipient; every lead this run generates goes to them */}
          {region && (
            <div style={S.card}>
              <span style={S.label}>{t('sectionAssignSdr')}</span>
              {visibleSdrs.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                  {/* The region name itself stays untranslated — it comes from `areas`/`markets`. */}
                  {t('noSdrsForRegion', { region: areaLabel(region) })}
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
                  {t('assignSummary', {
                    count: totalLeads,
                    name: sdrs.find(s => s.id === selectedSdrId)?.full_name ?? '?',
                  })}
                </p>
              )}
            </div>
          )}

          {submitError && (
            <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
              <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>{t('submitErrorTitle')}</p>
                <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' as const }}>{submitError}</p>
              </div>
            </div>
          )}

          <button onClick={handleRun} disabled={!canRun || submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, backgroundColor: canRun && !submitting ? 'var(--crm-accent)' : 'var(--crm-border)', color: '#FFF', cursor: canRun && !submitting ? 'pointer' : 'not-allowed', transition: 'all .15s' }}>
            {submitting && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
            {submitting ? t('starting') : overLimit ? t('limitReached') : t('runScraping')}
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
              {reconnecting
                ? `📡 ${t('reconnecting')}`
                : assignState === 'assigning'
                  ? t('distributing')
                  : t(STATUS_KEY[status] ?? 'statusWorking')}
            </div>
          </div>

          {reconnecting && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 9, backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40', marginBottom: 20, maxWidth: 420 }}>
              <AlertCircle size={14} color="#F59E0B" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', lineHeight: 1.5 }}>
                {t('reconnectingDetail')}
              </span>
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6, marginBottom: 0 }}>
            {t('progressHint')}
          </p>
          {summary && summary.leads_generated > 0 && (
            <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', marginTop: 10 }}>
              {t('leadsSoFar', { count: summary.leads_generated, total: summary.total_leads_requested })}
            </p>
          )}

          {assignState !== 'assigning' && (
            <button onClick={handleCancel} disabled={cancelling}
              style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 8, padding: '9px 18px', cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.5 : 1 }}>
              <XCircle size={14} /> {cancelling ? t('cancelling') : t('cancelRun')}
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>{t('cancelledTitle')}</h2>
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0, textAlign: 'center' }}>{t('cancelledDetail')}</p>
          <button onClick={resetToConfig}
            style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 22px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
            {t('newRun')}
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
            ✅ {t('completeTitle')}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--crm-text-secondary)', margin: '0 0 28px', textAlign: 'center' }}>
            {/* Country names come from `markets` — interpolated as-is, never translated. */}
            {t('completeSubtitle', {
              count: summary.leads_generated,
              markets: (summary.markets?.length ? summary.markets : [summary.market]).join(', '),
            })}
          </p>

          {/* Temperature cards */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 28, width: '100%', maxWidth: 420 }}>
            {[
              { key: 'HOT', emoji: '🔥', label: tTemp('Hot'), color: '#F87171', n: summary.temperature.HOT },
              { key: 'WARM', emoji: '🌡️', label: tTemp('Warm'), color: '#FBBF24', n: summary.temperature.WARM },
              { key: 'COLD', emoji: '❄️', label: tTemp('Cold'), color: '#60A5FA', n: summary.temperature.COLD },
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
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{t('assignedTo')}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{name}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)', marginTop: 4 }}>
                  {tCommon('leadsCount', { count: a?.leads_assigned ?? summary.leads_generated })}
                </div>
              </div>
            )
          })()}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => router.push(`/${locale}/history?run=${runId}`)}
              style={{ fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 20px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
              {t('viewDetailed')}
            </button>
            <button onClick={() => runId && downloadRunCsv(runId)}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', backgroundColor: 'transparent', padding: '11px 20px', borderRadius: 9, border: '1px solid var(--crm-border)', cursor: 'pointer' }}>
              {tExport('downloadCsv')}
            </button>
            <button onClick={resetToConfig}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-muted)', background: 'none', padding: '11px 16px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
              {t('newRun')}
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>{t('failedTitle')}</h2>

          {failureDetail ? (
            <div style={{ width: '100%', maxWidth: 520, marginTop: 4 }}>
              <div style={{ backgroundColor: '#EF444410', border: '1px solid #EF444430', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 11, color: '#EF4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{t('errorLabel')}</p>
                {/* `failureDetail` is the backend's own message — shown verbatim, never translated. */}
                <p style={{ fontSize: 12.5, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {failureDetail}
                </p>
              </div>
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0', textAlign: 'center' }}>
                {t('errorSupportHint')}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0, textAlign: 'center' }}>
              {t('noErrorDetails')}
            </p>
          )}

          <button onClick={resetToConfig}
            style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '11px 22px', borderRadius: 9, border: 'none', cursor: 'pointer' }}>
            {tCommon('retry')}
          </button>
        </div>
      )}
    </div>
  )
}

export function RunClient() {
  const tCommon = useTranslations('common')
  return (
    <Suspense fallback={<p style={{ color: 'var(--crm-text-muted)', padding: 40 }}>{tCommon('loading')}</p>}>
      <RunPageInner />
    </Suspense>
  )
}
