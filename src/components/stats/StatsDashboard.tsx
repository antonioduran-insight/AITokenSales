'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { TrendingUp, Users2, Calendar, Target } from 'lucide-react'
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
  area: string
  total: number
  replied: number
  closed: number
}

const STATUS_COLORS: Record<OutreachStatus, string> = {
  new: '#6C63FF',
  connection_sent: '#3B82F6',
  connected: '#22C55E',
  replied: '#F59E0B',
  demo_scheduled: '#EC4899',
  closed: '#10B981',
  nurture: '#8B8BA0',
}

const TEMP_COLORS: Record<string, string> = {
  Cold: '#3B82F6',
  Warm: '#F59E0B',
  Hot: '#EF4444',
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', overflowY: 'auto', height: '100%' },
  card: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: 20 },
  statCard: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: '#8B8BA0', marginBottom: 16, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  th: { padding: '8px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A3A' },
  td: { padding: '9px 12px', borderBottom: '1px solid #1C1C27', fontSize: 13 },
}

export function StatsDashboard() {
  const t = useTranslations('stats')
  const tc = useTranslations('common')
  const { user, isAdmin } = useUser()

  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    let query = supabase
      .from('prospects')
      .select('id, outreach_status, lead_temperature, area_id, assigned_to, created_at, area:areas(name, label_en), assigned_user:users!assigned_to(id, full_name, area_id)')

    if (!isAdmin && user.area_id) {
      query = query.eq('area_id', user.area_id)
    }

    query.then(({ data }) => {
      if (data) setProspects(data as unknown as ProspectRow[])
      setLoading(false)
    })
  }, [user, isAdmin])

  if (loading) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#52526A' }}>{tc('loading')}</span>
      </div>
    )
  }

  // Computed stats
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
  const replyRate = total > 0 ? ((replied / total) * 100).toFixed(1) : '0.0'

  // By status
  const byStatus = OUTREACH_STATUSES.map(s => ({
    status: s,
    count: prospects.filter(p => p.outreach_status === s).length,
  }))
  const maxByStatus = Math.max(...byStatus.map(s => s.count), 1)

  // By temperature
  const tempCounts = { Cold: 0, Warm: 0, Hot: 0, null: 0 }
  prospects.forEach(p => {
    const k = p.lead_temperature as keyof typeof tempCounts ?? 'null'
    if (k in tempCounts) tempCounts[k]++
    else tempCounts['null']++
  })

  // By area
  const areaMap = new Map<string, { label: string; count: number }>()
  prospects.forEach(p => {
    const key = p.area_id
    const label = p.area?.label_en ?? key
    const prev = areaMap.get(key) ?? { label, count: 0 }
    areaMap.set(key, { label, count: prev.count + 1 })
  })
  const byArea = Array.from(areaMap.values()).sort((a, b) => b.count - a.count)

  // SDR performance
  const sdrMap = new Map<string, SDRStat>()
  prospects.forEach(p => {
    if (!p.assigned_to || !p.assigned_user) return
    const u = p.assigned_user
    const prev = sdrMap.get(u.id) ?? { id: u.id, full_name: u.full_name, area: '', total: 0, replied: 0, closed: 0 }
    prev.total++
    if (['replied', 'demo_scheduled', 'closed'].includes(p.outreach_status)) prev.replied++
    if (p.outreach_status === 'closed') prev.closed++
    sdrMap.set(u.id, prev)
  })
  const sdrStats = Array.from(sdrMap.values()).sort((a, b) => b.total - a.total)

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>{t('title')}</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#6C63FF20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users2 size={20} color="#6C63FF" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#F0F0F5' }}>{total}</div>
            <div style={{ fontSize: 12, color: '#8B8BA0' }}>{t('totalLeads')}</div>
          </div>
        </div>

        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#22C55E20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TrendingUp size={20} color="#22C55E" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#F0F0F5' }}>{thisWeek}</div>
            <div style={{ fontSize: 12, color: '#8B8BA0' }}>{t('addedThisWeek')}</div>
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
            <div style={{ fontSize: 28, fontWeight: 700, color: '#F0F0F5' }}>{replyRate}%</div>
            <div style={{ fontSize: 12, color: '#8B8BA0' }}>{t('replyRate')}</div>
            <div style={{ fontSize: 10, color: '#3A3A4A', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{replied} replied</div>
          </div>
        </div>

        <div style={S.statCard}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#EC489920', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Calendar size={20} color="#EC4899" />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#F0F0F5' }}>{demos}</div>
            <div style={{ fontSize: 12, color: '#8B8BA0' }}>{t('demoScheduled')}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Funnel by status */}
        <div style={S.card}>
          <div style={S.sectionTitle}>{t('pipelineFunnel')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byStatus.map(({ status, count }) => (
              <div key={status}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: '#8B8BA0' }}>
                    {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLORS[status], fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>
                </div>
                <div style={{ height: 6, backgroundColor: '#2A2A3A', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(count / maxByStatus) * 100}%`,
                    backgroundColor: STATUS_COLORS[status],
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Temperature + Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Temperature */}
          <div style={S.card}>
            <div style={S.sectionTitle}>{t('temperatureDistribution')}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['Cold', 'Warm', 'Hot'] as const).map(temp => (
                <div key={temp} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: TEMP_COLORS[temp] }}>
                    {tempCounts[temp]}
                  </div>
                  <div style={{ fontSize: 11, color: TEMP_COLORS[temp], marginTop: 2, fontWeight: 600 }}>{temp}</div>
                  <div style={{ fontSize: 10, color: '#52526A', marginTop: 2 }}>
                    {total > 0 ? ((tempCounts[temp] / total) * 100).toFixed(0) : 0}%
                  </div>
                </div>
              ))}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#52526A' }}>
                  {tempCounts['null']}
                </div>
                <div style={{ fontSize: 11, color: '#52526A', marginTop: 2, fontWeight: 600 }}>{tc('unset')}</div>
              </div>
            </div>
          </div>

          {/* By area */}
          {isAdmin && byArea.length > 0 && (
            <div style={S.card}>
              <div style={S.sectionTitle}>{t('byArea')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {byArea.map(a => (
                  <div key={a.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#8B8BA0' }}>{a.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 4, backgroundColor: '#2A2A3A', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(a.count / total) * 100}%`, backgroundColor: '#6C63FF', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#F0F0F5', fontFamily: 'JetBrains Mono, monospace', minWidth: 24, textAlign: 'right' }}>
                        {a.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SDR Performance */}
      {sdrStats.length > 0 && (
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
                const rate = sdr.total > 0 ? ((sdr.replied / sdr.total) * 100).toFixed(0) : '0'
                return (
                  <tr key={sdr.id}>
                    <td style={{ ...S.td, color: '#F0F0F5', fontWeight: 500 }}>{sdr.full_name}</td>
                    <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: '#6C63FF' }}>{sdr.total}</td>
                    <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: '#F59E0B' }}>{sdr.replied}</td>
                    <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', color: '#10B981' }}>{sdr.closed}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, backgroundColor: '#2A2A3A', borderRadius: 2, overflow: 'hidden', maxWidth: 80 }}>
                          <div style={{ height: '100%', width: `${rate}%`, backgroundColor: '#22C55E', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#22C55E', fontFamily: 'JetBrains Mono, monospace' }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
