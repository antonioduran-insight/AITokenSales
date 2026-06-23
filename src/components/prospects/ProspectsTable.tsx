'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { useUser } from '@/contexts/UserContext'
import { ProspectDrawer } from './ProspectDrawer'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Search, ChevronLeft, ChevronRight, Users, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import type { Prospect, OutreachStatus, Area, User, LeadTemperature } from '@/lib/types'
import { OUTREACH_STATUSES, LEAD_TEMPERATURES } from '@/lib/types'

const PAGE_SIZE = 25

const STATUS_COLORS: Record<OutreachStatus, string> = {
  new: '#6C63FF',
  connection_sent: '#3B82F6',
  connected: '#22C55E',
  replied: '#F59E0B',
  demo_scheduled: '#EC4899',
  closed: '#10B981',
  nurture: '#8B8BA0',
}

function icpColor(score: number | null): string {
  if (score === null) return '#52526A'
  if (score <= 40) return '#EF4444'
  if (score <= 70) return '#F59E0B'
  return '#22C55E'
}

function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) + '…' : s
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px 7px 32px', fontSize: 13, width: 200, outline: 'none' },
  select: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px', fontSize: 13 },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A3A', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 14px', borderBottom: '1px solid #1C1C27', fontSize: 13, verticalAlign: 'middle' as const },
}

export function ProspectsTable() {
  const { user, isAdmin } = useUser()
  const t = useTranslations()

  const [prospects, setProspects] = useState<Prospect[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [areas, setAreas] = useState<Area[]>([])
  const [sdrs, setSdrs] = useState<User[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterStatus, setFilterStatus] = useState<OutreachStatus | ''>('')
  const [filterTemp, setFilterTemp] = useState<LeadTemperature | ''>('')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reassignTo, setReassignTo] = useState('')
  const [reassigning, setReassigning] = useState(false)

  // Drawer
  const [drawerProspect, setDrawerProspect] = useState<Prospect | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    createClient().from('areas').select('*').eq('is_active', true).then(({ data }) => {
      if (data) setAreas(data as Area[])
    })
    if (isAdmin) {
      createClient().from('users').select('*').eq('role', 'sdr').eq('is_active', true).then(({ data }) => {
        if (data) setSdrs(data as User[])
      })
    }
  }, [isAdmin])

  const fetchProspects = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      let query = supabase
        .from('prospects')
        .select('*, area:areas(*), assigned_user:users!assigned_to(id, full_name, email, role, area_id, is_active, created_at)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (!isAdmin && user?.area_id) query = query.eq('area_id', user.area_id)
      if (filterArea) query = query.eq('area_id', filterArea)
      if (filterStatus) query = query.eq('outreach_status', filterStatus)
      if (filterTemp) query = query.eq('lead_temperature', filterTemp)
      if (search.trim()) {
        query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`)
      }

      const { data, count } = await query
      if (data) setProspects(data as unknown as Prospect[])
      if (count !== null) setTotal(count)
    } finally {
      setLoading(false)
    }
  }, [page, search, filterArea, filterStatus, filterTemp, isAdmin, user?.area_id])

  useEffect(() => {
    if (user) fetchProspects()
  }, [user, fetchProspects])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [search, filterArea, filterStatus, filterTemp])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === prospects.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(prospects.map(p => p.id)))
    }
  }

  async function handleBulkReassign() {
    if (!reassignTo || selected.size === 0) return
    setReassigning(true)
    try {
      const supabase = createClient()
      const ids = Array.from(selected)
      await supabase.from('prospects').update({ assigned_to: reassignTo }).in('id', ids)

      const sdr = sdrs.find(s => s.id === reassignTo)
      for (const id of ids) {
        const prospect = prospects.find(p => p.id === id)
        await logAuditEvent({
          event_type: 'prospect_reassigned',
          prospect_id: id,
          prospect_name: prospect?.name,
          metadata: { to: sdr?.full_name ?? reassignTo },
        })
      }

      setSelected(new Set())
      setReassignTo('')
      fetchProspects()
    } finally {
      setReassigning(false)
    }
  }

  function clearFilters() {
    setSearch('')
    setFilterArea('')
    setFilterStatus('')
    setFilterTemp('')
  }

  const hasFilters = search || filterArea || filterStatus || filterTemp
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const allSelected = prospects.length > 0 && selected.size === prospects.length

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{t('nav.prospects')}</h1>

        <div style={S.header}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#52526A' }} />
            <input
              style={S.input}
              placeholder={t('common.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Area filter (admin only) */}
          {isAdmin && (
            <select value={filterArea} onChange={e => setFilterArea(e.target.value)} style={S.select}>
              <option value="">{t('areas.all')}</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.label_en}</option>)}
            </select>
          )}

          {/* Status filter */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as OutreachStatus | '')} style={S.select}>
            <option value="">{t('outreachStatus.all')}</option>
            {OUTREACH_STATUSES.map(s => <option key={s} value={s}>{t(`outreachStatus.${s}`)}</option>)}
          </select>

          {/* Temperature filter */}
          <select value={filterTemp} onChange={e => setFilterTemp(e.target.value as LeadTemperature | '')} style={S.select}>
            <option value="">{t('temperature.all')}</option>
            {LEAD_TEMPERATURES.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
          </select>

          {hasFilters && (
            <button onClick={clearFilters} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <X size={12} /> {t('common.clearFilters')}
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button onClick={fetchProspects} disabled={loading} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>

          <span style={{ fontSize: 12, color: '#52526A' }}>{t('common.leadsCount', { count: total })}</span>
        </div>

        {/* Bulk reassign bar */}
        {isAdmin && selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: '#6C63FF15', border: '1px solid #6C63FF40', borderRadius: 8, marginBottom: 12 }}>
            <Users size={14} color="#6C63FF" />
            <span style={{ fontSize: 13, color: '#F0F0F5' }}>{t('common.selected', { count: selected.size })}</span>
            <select
              value={reassignTo}
              onChange={e => setReassignTo(e.target.value)}
              style={{ ...S.select, minWidth: 180 }}
            >
              <option value="">{t('users.assignToSDR')}</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <Button
              onClick={handleBulkReassign}
              disabled={!reassignTo || reassigning}
              style={{ backgroundColor: '#6C63FF', color: '#FFF', height: 32, fontSize: 13 }}
            >
              {reassigning ? t('common.reassigning') : t('common.reassign')}
            </Button>
            <button onClick={() => setSelected(new Set())} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', backgroundColor: 'transparent', color: '#52526A', cursor: 'pointer', fontSize: 12 }}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #2A2A3A', borderRadius: 10, backgroundColor: '#13131A' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#13131A', zIndex: 1 }}>
            <tr>
              {isAdmin && (
                <th style={{ ...S.th, width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    style={{ accentColor: '#6C63FF', cursor: 'pointer' }}
                  />
                </th>
              )}
              <th style={S.th}>{t('prospect.name')}</th>
              <th style={S.th}>{t('prospect.company')}</th>
              <th style={S.th}>{t('prospect.outreachStatus')}</th>
              <th style={S.th}>{t('prospect.leadTemperature')}</th>
              <th style={{ ...S.th, fontFamily: 'JetBrains Mono, monospace' }}>{t('prospect.icpScore')}</th>
              {isAdmin && <th style={S.th}>{t('prospect.area')}</th>}
              <th style={S.th}>{t('prospect.assignedTo')}</th>
              <th style={S.th}>{t('prospect.createdAt')}</th>
              <th style={S.th}>{t('prospect.searchCombo')}</th>
              <th style={S.th}>{t('prospect.scrapeDate')}</th>
              <th style={S.th}>{t('prospect.market')}</th>
              <th style={S.th}>{t('prospect.custom1')}</th>
              <th style={S.th}>{t('prospect.custom2')}</th>
              <th style={S.th}>{t('prospect.custom3')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isAdmin ? 15 : 13} style={{ ...S.td, textAlign: 'center', color: '#52526A', padding: 40 }}>
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!loading && prospects.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 15 : 13} style={{ ...S.td, textAlign: 'center', color: '#52526A', padding: 40 }}>
                  {t('common.noData')}
                </td>
              </tr>
            )}
            {!loading && prospects.map(p => (
              <tr
                key={p.id}
                onClick={() => { setDrawerProspect(p); setDrawerOpen(true) }}
                style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {isAdmin && (
                  <td style={{ ...S.td, width: 40 }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      style={{ accentColor: '#6C63FF', cursor: 'pointer' }}
                    />
                  </td>
                )}
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: '#F0F0F5' }}>{p.name}</div>
                  {p.title && <div style={{ fontSize: 11, color: '#52526A', marginTop: 2 }}>{p.title}</div>}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0' }}>{p.company ?? '—'}</td>
                <td style={S.td}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    backgroundColor: STATUS_COLORS[p.outreach_status] + '20',
                    color: STATUS_COLORS[p.outreach_status],
                  }}>
                    {t(`outreachStatus.${p.outreach_status}`)}
                  </span>
                </td>
                <td style={S.td}>
                  {p.lead_temperature ? <TemperatureBadge temperature={p.lead_temperature} /> : <span style={{ color: '#52526A' }}>—</span>}
                </td>
                <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: icpColor(p.icp_score) }}>
                  {p.icp_score !== null ? p.icp_score : '—'}
                </td>
                {isAdmin && (
                  <td style={S.td}>
                    {p.area ? <AreaBadge area={p.area} size="sm" /> : <span style={{ color: '#52526A' }}>—</span>}
                  </td>
                )}
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }}>
                  {p.assigned_user?.full_name ?? <span style={{ color: '#52526A' }}>{t('common.unassigned')}</span>}
                </td>
                <td style={{ ...S.td, color: '#52526A', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                  {format(new Date(p.created_at), 'MMM d, yy')}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }}>
                  {p.search_combo ?? <span style={{ color: '#52526A' }}>—</span>}
                </td>
                <td style={{ ...S.td, color: '#52526A', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                  {p.scrape_date ?? '—'}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }}>
                  {p.market ?? <span style={{ color: '#52526A' }}>—</span>}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }} title={p.custom1 ?? undefined}>
                  {truncate(p.custom1)}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }} title={p.custom2 ?? undefined}>
                  {truncate(p.custom2)}
                </td>
                <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }} title={p.custom3 ?? undefined}>
                  {truncate(p.custom3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: page === 0 ? '#52526A' : '#F0F0F5', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: '#8B8BA0' }}>
            {t('common.page')} {page + 1} {t('common.of')} {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: page >= totalPages - 1 ? '#52526A' : '#F0F0F5', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Drawer */}
      {drawerProspect && (
        <ProspectDrawer
          prospect={drawerProspect}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setDrawerProspect(null) }}
          onUpdated={updated => {
            setProspects(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
            setDrawerProspect(updated)
          }}
        />
      )}
    </div>
  )
}
