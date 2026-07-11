'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { Play, AlertCircle, Minus, Plus, CheckCircle2, XCircle, Loader2, ArrowRight, Download } from 'lucide-react'
import type { User, ScraperComboMaster } from '@/lib/types'

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Global']
const MAX_INT = 2147483647
const STEP = 10
const MIN_LEADS = 10
const PLAN_LIMITS: Record<string, number> = {
  basic: 1000,
  premium: 3000,
  enterprise: 10000,
  ultra: MAX_INT,
}

interface RunLogEntry {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  created_at: string
}

const LOG_COLORS: Record<string, string> = {
  info: '#C9D1D9',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
}

const ACTIVE = new Set(['pending', 'running', 'scoring', 'drafting'])

const S: Record<string, React.CSSProperties> = {
  page:  { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 720 },
  card:  { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px' },
  label: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 12 },
  logBox:{ backgroundColor: '#0D1117', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '12px 14px', maxHeight: 380, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 },
}

function chipBtn(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : disabled ? 'var(--crm-text-muted)' : 'var(--crm-text-secondary)',
    opacity: disabled ? 0.4 : 1,
    transition: 'all .15s',
  }
}

export default function RunPage() {
  const { user, orgPlan } = useUser()
  const isAdmin = user?.role === 'admin'

  // ── Phase 1: config ──
  const [market, setMarket] = useState<string | null>(null)
  const [activeCombos, setActiveCombos] = useState<ScraperComboMaster[]>([])
  const [combosLoading, setCombosLoading] = useState(true)
  const [selectedCombos, setSelectedCombos] = useState<string[]>([])
  const [totalLeads, setTotalLeads] = useState(MIN_LEADS)
  const [monthlyUsed, setMonthlyUsed] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Phase 1: SDR selection ──
  const [sdrs, setSdrs] = useState<User[]>([])
  const [selectedSdrIds, setSelectedSdrIds] = useState<string[]>([])

  // ── Phase 2: run + logs ──
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string>('pending')
  const [logs, setLogs] = useState<RunLogEntry[]>([])
  const [leadsGenerated, setLeadsGenerated] = useState(0)
  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Phase 3: auto-assign on completion ──
  const [assignState, setAssignState] = useState<'idle' | 'assigning' | 'done' | 'error'>('idle')
  const [assignedCount, setAssignedCount] = useState(0)
  const [assignError, setAssignError] = useState<string | null>(null)
  const assignFiredRef = useRef(false)

  const maxLeads = PLAN_LIMITS[orgPlan ?? 'basic'] ?? 1000
  const available = maxLeads >= MAX_INT ? MAX_INT : Math.max(0, maxLeads - monthlyUsed)
  const leadsPerCombo = selectedCombos.length > 0 ? Math.floor(totalLeads / selectedCombos.length) : 0

  const canRun = !!market && selectedCombos.length > 0 && totalLeads >= MIN_LEADS &&
    selectedSdrIds.length > 0 && (available >= MAX_INT || totalLeads <= available)

  // Load combos
  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => setActiveCombos(Array.isArray(data) ? data.filter(c => c.org_active) : []))
      .catch(() => {})
      .finally(() => setCombosLoading(false))
  }, [])

  // Load monthly usage
  useEffect(() => {
    if (!isAdmin || !user?.organization_id) return
    const ym = new Date().toISOString().slice(0, 7)
    createClient()
      .from('monthly_lead_counts')
      .select('count')
      .eq('organization_id', user.organization_id)
      .eq('year_month', ym)
      .maybeSingle()
      .then(({ data }) => { if (data) setMonthlyUsed(data.count) })
  }, [isAdmin, user?.organization_id])

  // Load SDRs with scraper access (selected in phase 1)
  useEffect(() => {
    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('scraper_access', true)
      .then(({ data }) => { if (data) setSdrs(data as User[]) })
  }, [])

  // ── Poll logs while the run is active ──
  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/runs/${id}/logs`)
      if (!res.ok) return
      const data = await res.json()
      setLogs(Array.isArray(data.logs) ? data.logs : [])
      setLeadsGenerated(data.leads_generated ?? 0)
      setRunStatus(data.status ?? 'running')
      const el = logBoxRef.current
      if (el) el.scrollTop = el.scrollHeight
      if (!ACTIVE.has(data.status)) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
    } catch { /* transient */ }
  }, [])

  useEffect(() => {
    if (!runId) return
    poll(runId)
    if (ACTIVE.has(runStatus)) {
      pollRef.current = setInterval(() => poll(runId), 3000)
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // Stop polling when status leaves the active set
  useEffect(() => {
    if (!ACTIVE.has(runStatus) && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
  }, [runStatus])

  function stepLeads(delta: number) {
    setTotalLeads(v => {
      let next = v + delta
      if (next < MIN_LEADS) next = MIN_LEADS
      if (available < MAX_INT && next > available) next = available
      return next
    })
  }
  function manualLeads(raw: string) {
    const n = parseInt(raw.replace(/\D/g, ''), 10)
    setTotalLeads(Number.isNaN(n) ? 0 : n)
  }
  function clampLeads() {
    setTotalLeads(v => {
      let x = Math.max(MIN_LEADS, v)
      if (available < MAX_INT && x > available) x = available
      return x
    })
  }

  function toggleCombo(code: string) {
    setSelectedCombos(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
    setSubmitError(null)
  }
  function toggleSdr(id: string) {
    setSelectedSdrIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  async function handleRun() {
    if (!canRun || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market,
          markets: [market],
          combos: selectedCombos,
          total_leads: totalLeads,
          sdr_ids: selectedSdrIds,
          sdr_market_assignments: Object.fromEntries(
            selectedSdrIds.map(id => [id, market ? [market] : []])
          ),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(typeof data.error === 'string' ? data.error : JSON.stringify(data))
        return
      }
      setRunId(data.run_id)
      setRunStatus('pending')
      setLogs([])
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Preview distribution of the requested leads across the selected SDRs
  function previewDist(): Record<string, number> {
    const out: Record<string, number> = {}
    const n = selectedSdrIds.length
    if (!n || !totalLeads) return out
    const base = Math.floor(totalLeads / n)
    const rem = totalLeads % n
    selectedSdrIds.forEach((id, i) => { out[id] = base + (i < rem ? 1 : 0) })
    return out
  }

  // Push this run's scraper_leads into the SDRs' kanban boards.
  // Called automatically when the run completes — no user action required.
  const runAssign = useCallback(async () => {
    if (!runId) return
    setAssignState('assigning')
    setAssignError(null)
    try {
      const res = await fetch(`/api/runs/${runId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdr_ids: selectedSdrIds,
          sdr_market_assignments: Object.fromEntries(
            selectedSdrIds.map(id => [id, market ? [market] : []])
          ),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setAssignError(data.error ?? 'Assignment failed'); setAssignState('error'); return }
      setAssignedCount(data.assigned ?? 0)
      setAssignState('done')
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : String(e))
      setAssignState('error')
    }
  }, [runId, selectedSdrIds, market])

  // Auto-assign once, as soon as the run reports completed
  useEffect(() => {
    if (runStatus === 'completed' && !assignFiredRef.current && selectedSdrIds.length > 0) {
      assignFiredRef.current = true
      runAssign()
    }
  }, [runStatus, selectedSdrIds.length, runAssign])

  const isConfig = !runId
  const isRunning = !!runId && ACTIVE.has(runStatus)
  const isCompleted = !!runId && runStatus === 'completed'
  const isFailed = !!runId && runStatus === 'failed'
  const dist = previewDist()

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>New Pipeline</h1>

      {/* ══════════ PHASE 1 — CONFIG ══════════ */}
      {isConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Market */}
          <div style={S.card}>
            <span style={S.label}>Market</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {MARKETS.map(m => (
                <button key={m} onClick={() => { setMarket(m); setSubmitError(null) }} style={chipBtn(market === m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Combos */}
          <div style={S.card}>
            <span style={S.label}>Search Combos</span>
            {combosLoading ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p>
            ) : activeCombos.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                No active combos.{' '}
                <Link href="/settings?tab=scraper" style={{ color: 'var(--crm-accent)', textDecoration: 'none' }}>
                  Enable in Settings → Scraper
                </Link>
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {activeCombos.map(c => {
                  const active = selectedCombos.includes(c.code)
                  return (
                    <button key={c.code} onClick={() => toggleCombo(c.code)} style={{
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left' as const,
                      border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
                      backgroundColor: active ? '#6C63FF15' : 'var(--crm-surface-raised)',
                      color: active ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
                      transition: 'all .15s',
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
            {selectedCombos.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0' }}>
                {selectedCombos.length} combo{selectedCombos.length !== 1 ? 's' : ''} selected · ~{leadsPerCombo} leads per combo
              </p>
            )}
          </div>

          {/* Total leads */}
          <div style={S.card}>
            <span style={S.label}>Total Leads</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => stepLeads(-STEP)} disabled={totalLeads <= MIN_LEADS}
                style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', cursor: totalLeads <= MIN_LEADS ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: totalLeads <= MIN_LEADS ? 0.4 : 1 }}>
                <Minus size={16} />
              </button>
              <input
                value={totalLeads}
                onChange={e => manualLeads(e.target.value)}
                onBlur={clampLeads}
                inputMode="numeric"
                style={{ width: 120, textAlign: 'center', padding: '10px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 18, fontWeight: 700, fontFamily: 'monospace', outline: 'none' }}
              />
              <button onClick={() => stepLeads(STEP)} disabled={available < MAX_INT && totalLeads >= available}
                style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', cursor: (available < MAX_INT && totalLeads >= available) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (available < MAX_INT && totalLeads >= available) ? 0.4 : 1 }}>
                <Plus size={16} />
              </button>
            </div>
            {isAdmin && available < MAX_INT && (
              <p style={{ fontSize: 12, color: available < 100 ? '#EF4444' : 'var(--crm-text-muted)', margin: '12px 0 0' }}>
                {monthlyUsed} used this month · <strong style={{ color: available < 100 ? '#EF4444' : 'var(--crm-text-primary)' }}>{available}</strong> leads available
              </p>
            )}
          </div>

          {/* SDRs */}
          <div style={S.card}>
            <span style={S.label}>Assign to SDRs</span>
            {sdrs.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                No SDRs with scraper access. Enable it in Settings → Users.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sdrs.map(sdr => {
                  const sel = selectedSdrIds.includes(sdr.id)
                  return (
                    <label key={sdr.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, cursor: 'pointer',
                      backgroundColor: sel ? '#6C63FF10' : 'var(--crm-surface-raised)',
                      border: `1px solid ${sel ? '#6C63FF40' : 'var(--crm-border)'}`, transition: 'all .15s',
                    }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSdr(sdr.id)}
                        style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14 }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                      {sel && dist[sdr.id] != null && (
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--crm-accent)' }}>~{dist[sdr.id]} leads</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {selectedSdrIds.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '12px 0 0' }}>
                {totalLeads} leads → {selectedSdrIds.map(id => {
                  const s = sdrs.find(x => x.id === id)
                  return `${s?.full_name ?? '?'}: ~${dist[id] ?? 0}`
                }).join(' · ')}
              </p>
            )}
          </div>

          {/* Error */}
          {submitError && (
            <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
              <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>Could not start pipeline</p>
                <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' as const }}>{submitError}</p>
              </div>
            </div>
          )}

          {/* Run button */}
          <button onClick={handleRun} disabled={!canRun || submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600, backgroundColor: canRun && !submitting ? 'var(--crm-accent)' : 'var(--crm-border)', color: '#FFF', cursor: canRun && !submitting ? 'pointer' : 'not-allowed', transition: 'all .15s' }}>
            <Play size={15} />
            {submitting ? 'Starting…' : 'Run Pipeline'}
          </button>
        </div>
      )}

      {/* ══════════ PHASE 2 — LOGS ══════════ */}
      {!isConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {isRunning && <Loader2 size={16} color="var(--crm-accent)" style={{ animation: 'spin 1s linear infinite' }} />}
                {isCompleted && <CheckCircle2 size={16} color="#22C55E" />}
                {isFailed && <XCircle size={16} color="#EF4444" />}
                <span style={{ fontSize: 15, fontWeight: 700, textTransform: 'capitalize' }}>{runStatus}</span>
                {isRunning && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--crm-accent)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--crm-accent)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    Live
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
                {leadsGenerated} / {totalLeads} leads
              </span>
            </div>

            <div style={S.logBox} ref={logBoxRef}>
              {logs.length === 0 ? (
                <span style={{ color: '#52526A' }}>Waiting for logs…</span>
              ) : logs.map(log => (
                <div key={log.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ color: '#52526A', flexShrink: 0, fontSize: 10 }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                  <span style={{ color: LOG_COLORS[log.level] ?? '#C9D1D9', flexShrink: 0, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 52 }}>{log.level}</span>
                  <span style={{ color: LOG_COLORS[log.level] ?? '#C9D1D9', wordBreak: 'break-word' }}>{log.message}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Failed → allow retry */}
          {isFailed && (
            <button onClick={() => { setRunId(null); setLogs([]); setRunStatus('pending') }}
              style={{ alignSelf: 'flex-start', fontSize: 13, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '9px 16px', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>
              ← Start a new run
            </button>
          )}

          {/* ══════════ PHASE 3 — COMPLETION SUMMARY ══════════ */}
          {isCompleted && (
            <div style={{ ...S.card, borderColor: '#16A34A40', backgroundColor: '#14532D15' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <CheckCircle2 size={20} color="#22C55E" />
                <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#22C55E' }}>
                  {leadsGenerated} leads generated
                </p>
              </div>

              {assignState === 'assigning' && (
                <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 16px' }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  Distributing leads to the SDRs&apos; kanban boards…
                </p>
              )}
              {assignState === 'done' && (
                <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 16px' }}>
                  {assignedCount} leads distributed to the selected SDRs — now in their kanban boards.
                </p>
              )}
              {assignState === 'error' && (
                <div style={{ margin: '0 0 16px' }}>
                  <p style={{ fontSize: 13, color: '#EF4444', margin: '0 0 8px' }}>
                    Could not distribute leads: {assignError}
                  </p>
                  <button onClick={runAssign}
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '8px 16px', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>
                    Retry distribution
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                <Link href={`/export?run_id=${runId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  <Download size={14} /> Download CSV
                </Link>
                <Link href="/kanban" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  View in Kanban <ArrowRight size={14} />
                </Link>
                <Link href="/run" onClick={() => window.location.reload()} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 13, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  New Run
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
