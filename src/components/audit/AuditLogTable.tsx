'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { PremiumFeature } from '@/components/ui/PremiumFeature'
import { format } from 'date-fns'
import type { AuditLog, AuditEventType } from '@/lib/types'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { useUser } from '@/contexts/UserContext'

const PAGE_SIZE = 40

const EVENT_COLORS: Record<AuditEventType, string> = {
  prospect_created: '#22C55E',
  status_changed: '#6C63FF',
  prospect_reassigned: '#3B82F6',
  note_added: '#8B8BA0',
  conversation_added: '#A78BFA',
  duplicate_attempt: '#F59E0B',
  sdr_created: '#10B981',
  sdr_deactivated: '#EF4444',
  csv_import: '#EC4899',
}

const ALL_EVENTS: AuditEventType[] = [
  'prospect_created', 'status_changed', 'prospect_reassigned', 'note_added',
  'conversation_added', 'duplicate_attempt', 'sdr_created', 'sdr_deactivated', 'csv_import',
]

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', height: '100%', display: 'flex', flexDirection: 'column' },
  select: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '6px 10px', fontSize: 13 },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '6px 10px', fontSize: 13 },
  th: { padding: '9px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A3A', whiteSpace: 'nowrap' as const },
  td: { padding: '9px 14px', borderBottom: '1px solid #1C1C27', fontSize: 13, verticalAlign: 'top' as const },
}

function formatDetail(log: AuditLog): string {
  const m = log.metadata ?? {}
  switch (log.event_type) {
    case 'status_changed': return `${m.from_status} → ${m.to_status}`
    case 'prospect_reassigned': {
      const from = (m.from_sdr ?? m.from) as string | undefined
      const to = (m.to_sdr ?? m.to) as string | undefined
      return from ? `${from} → ${to ?? '?'}` : `→ ${to ?? '?'}`
    }
    case 'duplicate_attempt': return `${m.type ?? ''} duplicate`
    case 'csv_import': return `${m.imported ?? 0} imported, ${m.skipped ?? 0} skipped, ${m.forced ?? 0} forced`
    case 'sdr_created': return `${m.email ?? ''} → area ${m.area ?? ''}`
    case 'sdr_deactivated': return `SDR deactivated`
    default: return ''
  }
}

export function AuditLogTable() {
  const t = useTranslations('audit')
  const tc = useTranslations('common')
  const { isImpersonating, impersonateOrgId } = useOrgId()
  const { orgPlan } = useUser()

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  const [filterEvent, setFilterEvent] = useState<AuditEventType | ''>('')
  const [filterActor, setFilterActor] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      if (isImpersonating && impersonateOrgId) {
        const params = new URLSearchParams({ impersonate_org_id: impersonateOrgId, limit: '1000' })
        const res = await fetch(`/api/crm/audit_log?${params}`)
        const json = await res.json()
        let rows = (json.data ?? []) as AuditLog[]

        if (filterEvent) rows = rows.filter(l => l.event_type === filterEvent)
        if (filterActor) rows = rows.filter(l => l.actor_name.toLowerCase().includes(filterActor.toLowerCase()))
        if (dateFrom) rows = rows.filter(l => l.created_at >= dateFrom)
        if (dateTo) rows = rows.filter(l => l.created_at <= dateTo + 'T23:59:59')

        setTotal(rows.length)
        setLogs(rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE))
      } else {
        const supabase = createClient()
        let query = supabase
          .from('audit_log')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (filterEvent) query = query.eq('event_type', filterEvent)
        if (filterActor) query = query.ilike('actor_name', `%${filterActor}%`)
        if (dateFrom) query = query.gte('created_at', dateFrom)
        if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')

        const { data, count } = await query
        if (data) setLogs(data as AuditLog[])
        if (count !== null) setTotal(count)
      }
    } finally {
      setLoading(false)
    }
  }, [page, filterEvent, filterActor, dateFrom, dateTo, isImpersonating, impersonateOrgId])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { setPage(0) }, [filterEvent, filterActor, dateFrom, dateTo])

  function exportCSV() {
    const header = ['Timestamp', 'Actor', 'Event', 'Prospect', 'Detail']
    const csvRows = logs.map(l => [
      format(new Date(l.created_at), 'yyyy-MM-dd HH:mm'),
      l.actor_name,
      l.event_type,
      l.prospect_name ?? '',
      formatDetail(l),
    ])
    const csv = [header, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <PremiumFeature plan={orgPlan} requiredPlan="premium" featureName="Audit Log is available from Premium plan">
    <div style={S.page}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('title')}</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={fetchLogs} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={exportCSV}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', fontSize: 12 }}
            >
              <Download size={12} /> {t('export')}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filterEvent} onChange={e => setFilterEvent(e.target.value as AuditEventType | '')} style={S.select}>
            <option value="">{t('allEvents')}</option>
            {ALL_EVENTS.map(ev => (
              <option key={ev} value={ev}>{t(`events.${ev}`)}</option>
            ))}
          </select>

          <input
            style={S.input}
            placeholder={t('filterActor')}
            value={filterActor}
            onChange={e => setFilterActor(e.target.value)}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#52526A' }}>{t('dateFrom')}</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...S.input, colorScheme: 'dark' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#52526A' }}>{t('dateTo')}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...S.input, colorScheme: 'dark' }} />
          </div>

          <span style={{ fontSize: 12, color: '#52526A', marginLeft: 'auto' }}>{t('eventsCount', { count: total })}</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #2A2A3A', borderRadius: 10, backgroundColor: '#13131A' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#13131A', zIndex: 1 }}>
            <tr>
              <th style={S.th}>{t('timestamp')}</th>
              <th style={S.th}>{t('actor')}</th>
              <th style={S.th}>{t('event')}</th>
              <th style={S.th}>{t('prospect')}</th>
              <th style={S.th}>{t('detail')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#52526A', padding: 48 }}>Loading...</td>
              </tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#52526A', padding: 48 }}>{t('noEvents')}</td>
              </tr>
            )}
            {!loading && logs.map(log => {
              const color = EVENT_COLORS[log.event_type] ?? '#52526A'
              return (
                <tr key={log.id} style={{ borderTop: '1px solid #1C1C27' }}>
                  <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#52526A', whiteSpace: 'nowrap' }}>
                    {format(new Date(log.created_at), 'MMM d, yyyy')}<br />
                    <span style={{ color: '#3A3A4A' }}>{format(new Date(log.created_at), 'HH:mm:ss')}</span>
                  </td>
                  <td style={{ ...S.td, color: '#F0F0F5', fontWeight: 500 }}>{log.actor_name}</td>
                  <td style={S.td}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: color + '20', color }}>
                      {t(`events.${log.event_type}`)}
                    </span>
                  </td>
                  <td style={{ ...S.td, color: '#8B8BA0' }}>{log.prospect_name ?? '—'}</td>
                  <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }}>
                    {formatDetail(log)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: page === 0 ? '#52526A' : '#F0F0F5', cursor: page === 0 ? 'not-allowed' : 'pointer' }}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: '#8B8BA0' }}>
            {tc('page')} {page + 1} {tc('of')} {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: page >= totalPages - 1 ? '#52526A' : '#F0F0F5', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
    </PremiumFeature>
  )
}
