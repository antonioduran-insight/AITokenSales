'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { Play, AlertCircle, AlertTriangle } from 'lucide-react'
import type { Area, User, ScraperComboMaster, SenderProfile } from '@/lib/types'

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Global']
const LEAD_OPTIONS = [100, 200, 300, 400, 500]
const MAX_INT = 2147483647
const PLAN_LIMITS: Record<string, number> = {
  basic: 1000,
  premium: 3000,
  enterprise: 10000,
  ultra: MAX_INT,
}

interface SdrWithAreas extends User {
  user_areas: Array<{ area: Area }>
}

function getSdrMarkets(sdr: SdrWithAreas): string[] {
  return (sdr.user_areas ?? []).map(ua => ua.area.label_en)
}

function computeDistribution(
  selectedSdrIds: string[],
  selectedMarkets: string[],
  totalLeads: number,
  sdrs: SdrWithAreas[]
): Record<string, number> {
  if (!selectedSdrIds.length || !selectedMarkets.length || !totalLeads) return {}
  const leadsPerMarket = Math.floor(totalLeads / selectedMarkets.length)
  const totals: Record<string, number> = {}
  for (const market of selectedMarkets) {
    const inMarket = selectedSdrIds.filter(id => {
      const sdr = sdrs.find(s => s.id === id)
      return sdr && getSdrMarkets(sdr).includes(market)
    })
    if (!inMarket.length) continue
    const perSdr = Math.floor(leadsPerMarket / inMarket.length)
    for (const id of inMarket) totals[id] = (totals[id] ?? 0) + perSdr
  }
  return totals
}

const S: Record<string, React.CSSProperties> = {
  page:  { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 720 },
  card:  { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px' },
  label: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 12 },
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
  const router = useRouter()
  const locale = useLocale()

  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([])
  const [activeCombos, setActiveCombos] = useState<ScraperComboMaster[]>([])
  const [combosLoading, setCombosLoading] = useState(true)
  const [selectedCombos, setSelectedCombos] = useState<string[]>([])
  const [totalLeads, setTotalLeads] = useState<number | null>(null)
  const [sdrs, setSdrs] = useState<SdrWithAreas[]>([])
  const [selectedSdrIds, setSelectedSdrIds] = useState<string[]>([])
  const [senderProfiles, setSenderProfiles] = useState<Record<string, SenderProfile>>({})
  const [monthlyUsed, setMonthlyUsed] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Derived state
  const showSdrSection = isAdmin && orgPlan !== 'basic' && selectedMarkets.length > 0
  const maxLeads = PLAN_LIMITS[orgPlan ?? 'basic'] ?? 1000
  const available = maxLeads >= MAX_INT ? MAX_INT : Math.max(0, maxLeads - monthlyUsed)
  const leadsPerCombo = selectedCombos.length > 0 && totalLeads ? Math.floor(totalLeads / selectedCombos.length) : 0
  const distribution = computeDistribution(selectedSdrIds, selectedMarkets, totalLeads ?? 0, sdrs)

  const canRun = (
    selectedMarkets.length > 0 &&
    selectedCombos.length > 0 &&
    totalLeads !== null && totalLeads > 0 &&
    (!showSdrSection || selectedSdrIds.length > 0) &&
    (available >= MAX_INT || available >= (totalLeads ?? 0))
  )

  // Load combos
  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => setActiveCombos(data.filter(c => c.org_active)))
      .catch(() => {})
      .finally(() => setCombosLoading(false))
  }, [])

  // Load monthly usage (admin only; SDRs can't read this table)
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

  // Load SDRs with their areas
  useEffect(() => {
    if (!showSdrSection) { setSdrs([]); return }
    createClient()
      .from('users')
      .select('*, user_areas(area:areas(*))')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('scraper_access', true)
      .then(({ data }) => { if (data) setSdrs(data as SdrWithAreas[]) })
  }, [showSdrSection])

  // Load sender profiles (premium+ admin only)
  useEffect(() => {
    if (!isAdmin || orgPlan === 'basic') return
    fetch('/api/sender-profiles')
      .then(r => r.json())
      .then((profiles: SenderProfile[]) => {
        const map: Record<string, SenderProfile> = {}
        profiles.filter(p => p.is_default && p.is_active).forEach(p => { map[p.user_id] = p })
        setSenderProfiles(map)
      })
      .catch(() => {})
  }, [isAdmin, orgPlan])

  // Deselect SDRs who no longer match selected markets
  useEffect(() => {
    if (!sdrs.length) return
    setSelectedSdrIds(prev => prev.filter(id => {
      const sdr = sdrs.find(s => s.id === id)
      return sdr && getSdrMarkets(sdr).some(m => selectedMarkets.includes(m))
    }))
  }, [selectedMarkets, sdrs])

  function toggleMarket(m: string) {
    setSelectedMarkets(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
    setSubmitError(null)
  }

  function toggleCombo(code: string) {
    setSelectedCombos(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
    setSubmitError(null)
  }

  function toggleSdr(id: string) {
    setSelectedSdrIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  async function handleSubmit() {
    if (!canRun || submitting) return
    setSubmitting(true)
    setSubmitError(null)

    const sdrMarketAssignments: Record<string, string[]> = {}
    for (const sdrId of selectedSdrIds) {
      const sdr = sdrs.find(s => s.id === sdrId)
      if (!sdr) continue
      sdrMarketAssignments[sdrId] = getSdrMarkets(sdr)
        .filter(m => selectedMarkets.includes(m))
        .map(m => m.toLowerCase())
    }

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          combos: selectedCombos,
          market: selectedMarkets[0] ?? 'global',
          markets: selectedMarkets,
          total_leads: totalLeads,
          sdr_ids: selectedSdrIds,
          sdr_market_assignments: sdrMarketAssignments,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(typeof data.error === 'string' ? data.error : JSON.stringify(data))
        return
      }
      router.push(`/${locale}/history`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const showPreview = selectedMarkets.length > 0 && !!totalLeads

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>New Pipeline</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Markets ── */}
        <div style={S.card}>
          <span style={S.label}>Markets</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MARKETS.map(m => (
              <button key={m} onClick={() => toggleMarket(m)} style={chipBtn(selectedMarkets.includes(m))}>
                {m}
              </button>
            ))}
          </div>
          {selectedMarkets.length > 1 && totalLeads && (
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0' }}>
              Leads split equally — ~{Math.floor(totalLeads / selectedMarkets.length)} per market
            </p>
          )}
        </div>

        {/* ── Search Combos ── */}
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
              {selectedCombos.length} combo{selectedCombos.length !== 1 ? 's' : ''} selected
              {leadsPerCombo > 0 && ` · ~${leadsPerCombo} leads per combo`}
            </p>
          )}
        </div>

        {/* ── Total Leads ── */}
        <div style={S.card}>
          <span style={S.label}>Total Leads</span>
          {isAdmin && available < MAX_INT && (
            <p style={{ fontSize: 12, color: available < 100 ? '#EF4444' : 'var(--crm-text-muted)', margin: '0 0 12px' }}>
              {monthlyUsed} used this month · <strong style={{ color: available < 100 ? '#EF4444' : 'var(--crm-text-primary)' }}>{available}</strong> remaining
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LEAD_OPTIONS.map(n => {
              const disabled = available < n && available < MAX_INT
              return (
                <button key={n} onClick={() => !disabled && setTotalLeads(n)} style={chipBtn(totalLeads === n, disabled)}>
                  {n}
                </button>
              )
            })}
          </div>
          {totalLeads && selectedCombos.length > 0 && selectedMarkets.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '10px 0 0' }}>
              {totalLeads} leads · {selectedCombos.length} combo{selectedCombos.length !== 1 ? 's' : ''} · {selectedMarkets.length} market{selectedMarkets.length !== 1 ? 's' : ''}
              {selectedCombos.length > 0 ? ` · ~${leadsPerCombo} per combo` : ''}
            </p>
          )}
        </div>

        {/* ── Assign SDRs ── */}
        {showSdrSection && (
          <div style={S.card}>
            <span style={S.label}>Assign SDRs</span>
            {(() => {
              const visible = sdrs.filter(sdr => getSdrMarkets(sdr).some(m => selectedMarkets.includes(m)))
              if (visible.length === 0) return (
                <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
                  No SDRs with scraper access match the selected markets.
                </p>
              )
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visible.map(sdr => {
                    const sdrMarkets = getSdrMarkets(sdr).filter(m => selectedMarkets.includes(m))
                    const profile = senderProfiles[sdr.id]
                    const isSelected = selectedSdrIds.includes(sdr.id)
                    return (
                      <label key={sdr.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px',
                        borderRadius: 8, cursor: 'pointer',
                        backgroundColor: isSelected ? '#6C63FF10' : 'var(--crm-surface-raised)',
                        border: `1px solid ${isSelected ? '#6C63FF40' : 'var(--crm-border)'}`,
                        transition: 'all .15s',
                      }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSdr(sdr.id)}
                          style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14, flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)', marginBottom: 4 }}>
                            {sdr.full_name}
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: profile || !profile ? 4 : 0 }}>
                            {sdrMarkets.map(m => (
                              <span key={m} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 4, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)' }}>
                                {m}
                              </span>
                            ))}
                          </div>
                          {profile ? (
                            <div style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                              ✦ {profile.display_name}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#F59E0B' }}>
                              <AlertTriangle size={10} />
                              No sender profile — generic messages will be used
                            </div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── Distribution Preview ── */}
        {showPreview && (
          <div style={{ ...S.card, backgroundColor: '#6C63FF08', borderColor: '#6C63FF25' }}>
            <span style={S.label}>Distribution Preview</span>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--crm-text-primary)', margin: '0 0 12px' }}>
              {totalLeads} leads across {selectedMarkets.length} market{selectedMarkets.length !== 1 ? 's' : ''}: {selectedMarkets.join(' + ')}
            </p>
            {selectedSdrIds.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedSdrIds.map(id => {
                  const sdr = sdrs.find(s => s.id === id)
                  if (!sdr) return null
                  const leads = distribution[id] ?? 0
                  const sdrMarkets = getSdrMarkets(sdr).filter(m => selectedMarkets.includes(m))
                  return (
                    <div key={id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '9px 14px', borderRadius: 8,
                      backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
                    }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                        {sdrMarkets.length > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginLeft: 6 }}>
                            ({sdrMarkets.join(' + ')})
                          </span>
                        )}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--crm-accent)' }}>{leads} leads</span>
                    </div>
                  )
                })}
              </div>
            ) : showSdrSection ? (
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: 0 }}>
                Select SDRs above to see per-SDR distribution.
              </p>
            ) : null}
          </div>
        )}

        {/* ── Error ── */}
        {submitError && (
          <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
            <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>Could not start pipeline</p>
              <p style={{ fontSize: 12, color: 'var(--crm-text-secondary)', margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' as const }}>
                {submitError}
              </p>
            </div>
          </div>
        )}

        {/* ── Run Button ── */}
        <button
          onClick={handleSubmit}
          disabled={!canRun || submitting}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600,
            backgroundColor: canRun && !submitting ? 'var(--crm-accent)' : 'var(--crm-border)',
            color: '#FFF',
            cursor: canRun && !submitting ? 'pointer' : 'not-allowed',
            transition: 'all .15s',
          }}
        >
          <Play size={15} />
          {submitting ? 'Starting…' : 'Run Pipeline'}
        </button>

      </div>
    </div>
  )
}
