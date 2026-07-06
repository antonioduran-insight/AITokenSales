'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { TrendingUp, Users2, Calendar, Target, Trophy } from 'lucide-react'
import { PremiumFeature } from '@/components/ui/PremiumFeature'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import type { OutreachStatus, AreaName } from '@/lib/types'
import { OUTREACH_STATUSES } from '@/lib/types'

interface ProspectRow {
  id: string
  outreach_status: OutreachStatus
  lead_temperature: string | null
  area_id: string
  assigned_to: string | null
  created_at: string
  area?: { name: AreaName; label_en: string }
  assigned_user?: { id: string; full_name: string; area_id: string | null }
}

interface SDRStat {
  id: string
  full_name: string
  total: number
  replied: number
  closed: number
}

interface AreaStat {
  label: string
  total: number
  closed: number
}

const STATUS_COLORS: Record<OutreachStatus, string> = {
  new: 'var(--crm-accent)',
  connection_sent: '#3B82F6',
  connected: '#22C55E',
  replied: '#F59E0B',
  demo_scheduled: '#EC4899',
  closed: '#10B981',
  nurture: 'var(--crm-text-secondary)',
}

const TEMP_COLORS: Record<string, string> = {
  Cold: '#3B82F6',
  Warm: '#F59E0B',
  Hot: '#EF4444',
}

function convRateColor(rate: number): string {
  if (rate > 5) return '#22C55E'
  if (rate >= 1) return '#F59E0B'
  return '#EF4444'
}

function ProgressBar({ value, max, color = 'var(--crm-accent)', height = 5 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ flex: 1, height, backgroundColor: 'var(--crm-border)', borderRadius: height, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: height, transition: 'width 0.5s ease' }} />
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: 'var(--crm-text-primary)', overflowY: 'auto', height: '100%' },
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: 20 },
  bigCard: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24 },
  statCard: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: 'var(--crm-text-muted)', marginBottom: 16, textTransform: 'uppercase' as const, letterSpacing: '0.07em' },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: 'var(--crm-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 },
  th: { padding: '8px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid var(--crm-border)' },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--crm-surface-raised)', fontSize: 13 },
}

const STATS_SELECT = 'id, outreach_status, lead_temperature, area_id, assigned_to, created_at, area:areas(name, label_en), assigned_user:users!assigned_to(id, full_name, area_id)'

export function StatsDashboard() {
  const t = useTranslations('stats')
  const tc = useTranslations('common')
  const { user, isAdmin: userIsAdmin, orgPlan } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin } = useOrgId()

  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user && !isImpersonating) return

    async function load() {
      if (isImpersonating && impersonateOrgId) {
        const params = new URLSearchParams({ impersonate_org_id: impersonateOrgId, select: STATS_SELECT, limit: '5000' })
        const res = await fetch(`/api/crm/prospects?${params}`)
        const json = await res.json()
        if (json.data) setProspects(json.data as ProspectRow[])
      } else {
        const supabase = createClient()
        let query = supabase.from('prospects').select(STATS_SELECT)
        if (!userIsAdmin && user?.area_id) query = query.eq('area_id', user.area_id)
        const { data } = await query
        if (data) setProspects(data as unknown as ProspectRow[])
      }
      setLoading(false)
    }

    load()
  }, [user, userIsAdmin, isAdmin, isImpersonating, impersonateOrgId])

  if (loading) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--crm-text-muted)' }}>{tc('loading')}</span>
      </div>
    )
  }

  // ── Core counts ────────────────────────────────────────────────────────────
  const total = prospects.length
  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const thisWeek = prospects.filter(p => {
    const d = new Date(p.created_at)
    return d >= weekStart && d <= weekEnd
  }).length

  const replied = prospects.filter(p => ['replied', 'demo_scheduled', 'closed'].includes(p.outreach_status)).length
  const demos = prospects.filter(p => p.outreach_status === 'demo_scheduled').length
  const closedTotal = prospects.filter(p => p.outreach_status === 'closed').length
  const replyRate = total > 0 ? ((replied / total) * 100).toFixed(1) : '0.0'

  const globalConvRate = total > 0 ? (closedTotal / total) * 100 : 0
  const globalConvColor = '#22C55E'

  // ── By status ──────────────────────────────────────────────────────────────
  const byStatus = OUTREACH_STATUSES.map(s => ({
    status: s,
    count: prospects.filter(p => p.outreach_status === s).length,
  }))
  const maxByStatus = Math.max(...byStatus.map(s => s.count), 1)

  // ── By temperature ─────────────────────────────────────────────────────────
  const tempCounts = { Cold: 0, Warm: 0, Hot: 0, null: 0 }
  prospects.forEach(p => {
    const k = p.lead_temperature as keyof typeof tempCounts ?? 'null'
    if (k in tempCounts) tempCounts[k]++
    else tempCounts['null']++
  })

  // ── SDR stats (sorted by conversion rate desc) ─────────────────────────────
  const sdrMap = new Map<string, SDRStat>()
  prospects.forEach(p => {
    if (!p.assigned_to || !p.assigned_user) return
    const u = p.assigned_user
    const prev = sdrMap.get(u.id) ?? { id: u.id, full_name: u.full_name, total: 0, replied: 0, closed: 0 }
    prev.total++
    if (['replied', 'demo_scheduled', 'closed'].includes(p.outreach_status)) prev.replied++
    if (p.outreach_status === 'closed') prev.closed++
    sdrMap.set(u.id, prev)
  })
  const sdrStats = Array.from(sdrMap.values()).sort((a, b) => {
    const ra = a.total > 0 ? a.closed / a.total : 0
    const rb = b.total > 0 ? b.closed / b.total : 0
    return rb - ra
  })
  const maxSdrRate = Math.max(...sdrStats.map(s => s.total > 0 ? (s.closed / s.total) * 100 : 0), 1)

  // ── Area stats (sorted by conversion rate desc) ────────────────────────────
  const areaStatsMap = new Map<string, AreaStat>()
  prospects.forEach(p => {
    const key = p.area_id
    const label = p.area?.label_en ?? key
    const prev = areaStatsMap.get(key) ?? { label, total: 0, closed: 0 }
    prev.total++
    if (p.outreach_status === 'closed') prev.closed++
    areaStatsMap.set(key, prev)
  })
  const areaStats = Array.from(areaStatsMap.values()).sort((a, b) => {
    const ra = a.total > 0 ? a.closed / a.total : 0
    const rb = b.total > 0 ? b.closed / b.total : 0
    return rb - ra
  })
  const maxAreaRate = Math.max(...areaStats.map(a => a.total > 0 ? (a.closed / a.total) * 100 : 0), 1)

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{t('title')}</h1>

      {/* ── SECTION 1: Conversion Rate ─────────────────────────────────────── */}
      <PremiumFeature plan={orgPlan} requiredPlan="premium" featureName="Conversion Rate Analytics">
        <div style={{ marginBottom: 8 }}>
          <div style={S.sectionLabel}>
            <Trophy size={14} color="#F59E0B" />
            {t('conversionSection')}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr', gap: 14, marginBottom: 28 }}>

          {/* Card 1 — Global */}
          <div style={{ ...S.bigCard, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              {t('conversionGlobal')}
            </div>
            <div style={{ fontSize: 56, fontWeight: 800, color: globalConvColor, lineHeight: 1, marginBottom: 8 }}>
              {globalConvRate.toFixed(1)}%
            </div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
              {closedTotal} {t('closedOf')} {total} total
            </div>
            <div style={{ width: '100%', marginTop: 16 }}>
              <ProgressBar value={closedTotal} max={total} color={globalConvColor} height={6} />
            </div>
          </div>

          {/* Card 2 — By SDR */}
          <div style={S.bigCard}>
            <div style={S.sectionTitle}>{t('conversionBySdr')}</div>
            {sdrStats.length === 0 ? (
              <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{t('noData')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sdrStats.map(sdr => {
                  const rate = sdr.total > 0 ? (sdr.closed / sdr.total) * 100 : 0
                  const color = convRateColor(rate)
                  return (
                    <div key={sdr.id}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, color: 'var(--crm-text-primary)', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {sdr.full_name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 10 }}>
                          <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {sdr.closed}/{sdr.total}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', minWidth: 44, textAlign: 'right' }}>
                            {rate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <ProgressBar value={rate} max={maxSdrRate} color={color} height={4} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Card 3 — By Area */}
          <div style={S.bigCard}>
            <div style={S.sectionTitle}>{t('conversionByArea')}</div>
            {areaStats.length === 0 ? (
              <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{t('noData')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {areaStats.map(a => {
                  const rate = a.total > 0 ? (a.closed / a.total) * 100 : 0
                  const color = convRateColor(rate)
                  return (
                    <div key={a.label}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--crm-text-primary)', fontWeight: 600 }}>{a.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {a.closed}/{a.total}
                          </span>
                          <span style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace', minWidth: 52, textAlign: 'right' }}>
                            {rate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <ProgressBar value={rate} max={maxAreaRate} color={color} height={6} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PremiumFeature>

      {/* ── SECTION 2: Quick metrics ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#6C63FF20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users2 size={20} color="var(--crm-accent)" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{total}</div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{t('totalLeads')}</div>
          </div>
        </div>

        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#22C55E20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TrendingUp size={20} color="#22C55E" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{thisWeek}</div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{t('addedThisWeek')}</div>
            <div style={{ fontSize: 10, color: '#3A3A4A', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
              {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
            </div>
          </div>
        </div>

        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#F59E0B20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Target size={20} color="#F59E0B" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{replyRate}%</div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{t('replyRate')}</div>
            <div style={{ fontSize: 10, color: '#3A3A4A', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{replied} replied</div>
          </div>
        </div>

        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#EC489920', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Calendar size={20} color="#EC4899" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{demos}</div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{t('demoScheduled')}</div>
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Pipeline Funnel + Temperature ───────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Funnel by status */}
        <div style={S.card}>
          <div style={S.sectionTitle}>{t('pipelineFunnel')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byStatus.map(({ status, count }) => (
              <div key={status}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                    {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLORS[status], fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>
                </div>
                <ProgressBar value={count} max={maxByStatus} color={STATUS_COLORS[status]} height={6} />
              </div>
            ))}
          </div>
        </div>

        {/* Temperature + By Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={S.card}>
            <div style={S.sectionTitle}>{t('temperatureDistribution')}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['Cold', 'Warm', 'Hot'] as const).map(temp => (
                <div key={temp} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: TEMP_COLORS[temp] }}>{tempCounts[temp]}</div>
                  <div style={{ fontSize: 11, color: TEMP_COLORS[temp], marginTop: 2, fontWeight: 600 }}>{temp}</div>
                  <div style={{ fontSize: 10, color: 'var(--crm-text-muted)', marginTop: 2 }}>
                    {total > 0 ? ((tempCounts[temp] / total) * 100).toFixed(0) : 0}%
                  </div>
                </div>
              ))}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--crm-text-muted)' }}>{tempCounts['null']}</div>
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 2, fontWeight: 600 }}>{tc('unset')}</div>
              </div>
            </div>
          </div>

          {/* By area (compact) */}
          {isAdmin && areaStats.length > 0 && (
            <div style={S.card}>
              <div style={S.sectionTitle}>{t('byArea')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {areaStats.map(a => (
                  <div key={a.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{a.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ProgressBar value={a.total} max={total} color="var(--crm-accent)" height={4} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--crm-text-primary)', fontFamily: 'JetBrains Mono, monospace', minWidth: 24, textAlign: 'right' }}>
                        {a.total}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 5: SDR Performance ─────────────────────────────────────── */}
      {sdrStats.length > 0 && (
        <PremiumFeature plan={orgPlan} requiredPlan="premium" featureName="SDR Performance is a Premium feature">
          <div style={S.card}>
            <div style={S.sectionTitle}>{t('sdrPerformance')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={S.th}>{t('sdrName')}</th>
                  <th style={S.th}>{t('assigned')}</th>
                  <th style={S.th}>{t('repliedCount')}</th>
                  <th style={S.th}>{t('closed')}</th>
                  <th style={S.th}>{t('conversionRate')}</th>
                </tr>
              </thead>
              <tbody>
                {sdrStats.map(sdr => {
                  const convRate = sdr.total > 0 ? (sdr.closed / sdr.total) * 100 : 0
                  const color = convRateColor(convRate)
                  return (
                    <tr key={sdr.id}>
                      <td style={{ ...S.td, color: 'var(--crm-text-primary)', fontWeight: 500 }}>{sdr.full_name}</td>
                      <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: 'var(--crm-accent)' }}>{sdr.total}</td>
                      <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: '#F59E0B' }}>{sdr.replied}</td>
                      <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: '#10B981' }}>{sdr.closed}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, flexShrink: 0 }}>
                            <ProgressBar value={convRate} max={Math.max(maxSdrRate, 1)} color={color} height={4} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
                            {convRate.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </PremiumFeature>
      )}
    </div>
  )
}
