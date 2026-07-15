'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { useHasAddon } from '@/lib/hooks/useHasAddon'
import { AddonFeature } from '@/components/ui/AddonFeature'
import { Play, AlertCircle, Minus, Plus, CheckCircle2, XCircle, Loader2, ArrowRight, Download } from 'lucide-react'
import type { User, OrgCompanySeedList } from '@/lib/types'

const STEP = 10
const MIN_LEADS = 10

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

function BdRunContent() {
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  const hasBdGroup = useHasAddon('bd_group')

  // ── Phase 1: config ──
  const [seedLists, setSeedLists] = useState<OrgCompanySeedList[]>([])
  const [seedListsLoading, setSeedListsLoading] = useState(true)
  const [selectedSeedListIds, setSelectedSeedListIds] = useState<string[]>([])
  const [totalLeads, setTotalLeads] = useState(MIN_LEADS)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Phase 1: owner selection (single SDR, not a checklist) ──
  const [sdrs, setSdrs] = useState<User[]>([])
  const [ownerSdrId, setOwnerSdrId] = useState<string>('')

  // ── Phase 2: run + logs ──
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string>('pending')
  const [logs, setLogs] = useState<RunLogEntry[]>([])
  const [leadsGenerated, setLeadsGenerated] = useState(0)
  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canRun = selectedSeedListIds.length > 0 && !!ownerSdrId && totalLeads >= MIN_LEADS

  // Load seed lists
  useEffect(() => {
    createClient()
      .from('org_company_seed_lists')
      .select('*')
      .then(({ data }) => {
        if (data) setSeedLists(data as OrgCompanySeedList[])
        setSeedListsLoading(false)
      })
  }, [])

  // Load SDRs with scraper access (owner picker)
  useEffect(() => {
    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('scraper_access', true)
      .then(({ data }) => { if (data) setSdrs(data as User[]) })
  }, [])

  // ── Poll logs while the run is active — identical mechanism to the
  // individual-lead flow; GET /api/runs/[id]/logs works generically by
  // run_id regardless of run_type ──
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

  useEffect(() => {
    if (!ACTIVE.has(runStatus) && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
  }, [runStatus])

  function stepLeads(delta: number) {
    setTotalLeads(v => Math.max(MIN_LEADS, v + delta))
  }
  function manualLeads(raw: string) {
    const n = parseInt(raw.replace(/\D/g, ''), 10)
    setTotalLeads(Number.isNaN(n) ? 0 : n)
  }
  function clampLeads() {
    setTotalLeads(v => Math.max(MIN_LEADS, v))
  }

  function toggleSeedList(id: string) {
    setSelectedSeedListIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
    setSubmitError(null)
  }

  async function handleRun() {
    if (!canRun || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/bd-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_list_ids: selectedSeedListIds,
          owner_sdr_id: ownerSdrId,
          total_leads: totalLeads,
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

  const isConfig = !runId
  const isRunning = !!runId && ACTIVE.has(runStatus)
  const isCompleted = !!runId && runStatus === 'completed'
  const isFailed = !!runId && runStatus === 'failed'

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>Loading…</div>
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>
        <p style={{ fontSize: 15 }}>BD New Run is only accessible to organization admins.</p>
      </div>
    )
  }

  return (
    <AddonFeature hasAccess={hasBdGroup} featureName="BD New Run">
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>BD New Run</h1>

      {/* ══════════ PHASE 1 — CONFIG ══════════ */}
      {isConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Seed lists (multi-select) */}
          <div style={S.card}>
            <span style={S.label}>Seed Lists</span>
            {seedListsLoading ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p>
            ) : seedLists.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                No seed lists yet. Create one in Settings → BD Group.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {seedLists.map(sl => {
                  const active = selectedSeedListIds.includes(sl.id)
                  return (
                    <button key={sl.id} onClick={() => toggleSeedList(sl.id)} style={{
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left' as const,
                      border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
                      backgroundColor: active ? '#6C63FF15' : 'var(--crm-surface-raised)',
                      color: active ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
                      transition: 'all .15s',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                        {active && <span style={{ marginRight: 4 }}>✓</span>}{sl.list_name}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {sl.company_names.length} companies{sl.market ? ` · ${sl.market}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedSeedListIds.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0' }}>
                {selectedSeedListIds.length} seed list{selectedSeedListIds.length !== 1 ? 's' : ''} selected
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
              <button onClick={() => stepLeads(STEP)}
                style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Owner SDR — single-select, not a checklist */}
          <div style={S.card}>
            <span style={S.label}>Owning SDR</span>
            {sdrs.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                No SDRs with scraper access. Enable it in Settings → Users.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sdrs.map(sdr => {
                  const sel = ownerSdrId === sdr.id
                  return (
                    <label key={sdr.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 8, cursor: 'pointer',
                      backgroundColor: sel ? '#6C63FF10' : 'var(--crm-surface-raised)',
                      border: `1px solid ${sel ? '#6C63FF40' : 'var(--crm-border)'}`, transition: 'all .15s',
                    }}>
                      <input type="radio" name="owner_sdr" checked={sel} onChange={() => setOwnerSdrId(sdr.id)}
                        style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14 }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                    </label>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '12px 0 0' }}>
              A BD run belongs to exactly one SDR — every resulting channel this run confirms will default to their ownership.
            </p>
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
            {submitting ? 'Starting…' : 'Run BD Pipeline'}
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
                {leadsGenerated} / {totalLeads} candidates
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
                  {leadsGenerated} candidates generated
                </p>
              </div>
              <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 16px' }}>
                These are unverified BD candidates — nothing lands in the CRM until each one is reviewed and confirmed.
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                <Link href={`/export?run_id=${runId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  <Download size={14} /> Download CSV
                </Link>
                <Link href="/bd-leads" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  Review BD Leads <ArrowRight size={14} />
                </Link>
                <Link href="/bd-run" onClick={() => window.location.reload()} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 13, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
                  New Run
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </AddonFeature>
  )
}

export default function BdRunPage() {
  return <BdRunContent />
}
