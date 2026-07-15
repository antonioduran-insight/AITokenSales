'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { ProspectDrawer } from './ProspectDrawer'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Search, ChevronLeft, ChevronRight, Users, RefreshCw, X, Trash2, CheckCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import type { Prospect, OutreachStatus, Area, User, LeadTemperature } from '@/lib/types'
import { OUTREACH_STATUSES, LEAD_TEMPERATURES } from '@/lib/types'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250]

const STATUS_COLORS: Record<OutreachStatus, string> = {
  new: 'var(--crm-accent)',
  connection_sent: '#3B82F6',
  connected: '#22C55E',
  replied: '#F59E0B',
  demo_scheduled: '#EC4899',
  closed: '#10B981',
  nurture: 'var(--crm-text-secondary)',
}

function icpColor(score: number | null): string {
  if (score === null) return 'var(--crm-text-muted)'
  if (score <= 40) return '#EF4444'
  if (score <= 70) return '#F59E0B'
  return '#22C55E'
}

function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) + '…' : s
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: 'var(--crm-text-primary)', height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  input: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', padding: '7px 10px 7px 32px', fontSize: 13, width: 200, outline: 'none' },
  select: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', padding: '7px 10px', fontSize: 13 },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid var(--crm-border)', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 14px', borderBottom: '1px solid var(--crm-surface-raised)', fontSize: 13, verticalAlign: 'middle' as const },
}

const PROSPECT_SELECT = '*, area:areas(*), assigned_user:users!assigned_to(id, full_name, email, role, area_id, is_active, created_at), bd_channel:bd_channels(id, company_name, channel_family, status, partnership_model, market, notes, owner_sdr_id, run_id, channel_family_type:channel_family_types(label))'

export function ProspectsTable() {
  const { user } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin } = useOrgId()
  const t = useTranslations()

  const [prospects, setProspects] = useState<Prospect[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)
  const [areas, setAreas] = useState<Area[]>([])
  const [sdrs, setSdrs] = useState<User[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterSdr, setFilterSdr] = useState('')
  const [filterStatus, setFilterStatus] = useState<OutreachStatus | ''>('')
  const [filterTemp, setFilterTemp] = useState<LeadTemperature | ''>('')

  // Selection (for bulk delete)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // SDR reassign modal
  const [sdrReassignOpen, setSdrReassignOpen] = useState(false)
  const [sdrReassignFrom, setSdrReassignFrom] = useState('')
  const [sdrReassignTo, setSdrReassignTo] = useState('')
  const [sdrReassignCount, setSdrReassignCount] = useState<number | null>(null)
  const [sdrReassignLimit, setSdrReassignLimit] = useState('')
  const [sdrReassigning, setSdrReassigning] = useState(false)
  const [reassignToast, setReassignToast] = useState<string | null>(null)

  // Drawer
  const [drawerProspect, setDrawerProspect] = useState<Prospect | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('areas').select('*').eq('is_active', true),
      isAdmin ? supabase.from('users').select('*').eq('role', 'sdr').eq('is_active', true) : Promise.resolve({ data: null }),
    ]).then(([areasRes, sdrsRes]) => {
      if (areasRes.data) setAreas(areasRes.data as Area[])
      if (sdrsRes.data) setSdrs(sdrsRes.data as User[])
    })
  }, [isAdmin])

  const fetchProspects = useCallback(async () => {
    setLoading(true)
    try {
      if (isImpersonating && impersonateOrgId) {
        const params = new URLSearchParams({
          impersonate_org_id: impersonateOrgId,
          select: PROSPECT_SELECT,
          limit: '1000',
        })
        const res = await fetch(`/api/crm/prospects?${params}`)
        const json = await res.json()
        let rows = (json.data ?? []) as unknown as Prospect[]

        // Client-side filters
        if (filterStatus) rows = rows.filter(p => p.outreach_status === filterStatus)
        if (filterTemp) rows = rows.filter(p => p.lead_temperature === filterTemp)
        if (filterArea) rows = rows.filter(p => p.area_id === filterArea)
        if (filterSdr === 'unassigned') rows = rows.filter(p => !p.assigned_to)
        else if (filterSdr) rows = rows.filter(p => p.assigned_to === filterSdr)
        if (search.trim()) {
          const q = search.toLowerCase()
          rows = rows.filter(p =>
            p.name?.toLowerCase().includes(q) ||
            p.company?.toLowerCase().includes(q) ||
            p.email?.toLowerCase().includes(q)
          )
        }

        setTotal(rows.length)
        const start = page * pageSize
        setProspects(rows.slice(start, start + pageSize))
      } else {
        const supabase = createClient()
        let query = supabase
          .from('prospects')
          .select(PROSPECT_SELECT, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (!isAdmin && user?.area_id) query = query.eq('area_id', user.area_id)
        if (filterArea) query = query.eq('area_id', filterArea)
        if (filterSdr === 'unassigned') query = query.is('assigned_to', null)
        else if (filterSdr) query = query.eq('assigned_to', filterSdr)
        if (filterStatus) query = query.eq('outreach_status', filterStatus)
        if (filterTemp) query = query.eq('lead_temperature', filterTemp)
        if (search.trim()) {
          query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`)
        }

        const { data, count } = await query
        if (data) setProspects(data as unknown as Prospect[])
        if (count !== null) setTotal(count)
      }
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, filterArea, filterSdr, filterStatus, filterTemp, isAdmin, user?.area_id, isImpersonating, impersonateOrgId])

  useEffect(() => {
    if (user) fetchProspects()
  }, [user, fetchProspects])

  // Reset page when filters or page size change
  useEffect(() => { setPage(0) }, [search, filterArea, filterStatus, filterTemp, pageSize])

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

  // Fetch count of leads for the FROM SDR whenever it changes
  useEffect(() => {
    if (!sdrReassignFrom) { setSdrReassignCount(null); return }
    createClient()
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', sdrReassignFrom)
      .then(({ count }) => setSdrReassignCount(count ?? 0))
  }, [sdrReassignFrom])

  async function handleSdrReassign() {
    if (!sdrReassignFrom || !sdrReassignTo) return
    setSdrReassigning(true)
    try {
      const fromSdr = sdrs.find(s => s.id === sdrReassignFrom)
      const res = await fetch('/api/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_user_id: sdrReassignFrom, to_user_id: sdrReassignTo, limit: sdrReassignLimit ? Number(sdrReassignLimit) : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setSdrReassigning(false); return }

      await logAuditEvent({
        event_type: 'prospect_reassigned',
        metadata: {
          from_sdr: fromSdr?.full_name ?? sdrReassignFrom,
          to_sdr: data.sdr_name ?? sdrReassignTo,
          bulk: true,
          count: data.reassigned,
        },
      })

      setSdrReassignOpen(false)
      setSdrReassignFrom('')
      setSdrReassignTo('')
      setSdrReassignCount(null)
      setSdrReassignLimit('')
      setReassignToast(`${data.reassigned} lead${data.reassigned !== 1 ? 's' : ''} reassigned to ${data.sdr_name}`)
      setTimeout(() => setReassignToast(null), 3500)
      fetchProspects()
    } finally {
      setSdrReassigning(false)
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const ids = Array.from(selected)
      const res = await fetch('/api/prospects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) {
        const json = await res.json()
        setDeleteError(json.error ?? 'Error desconocido')
        return
      }
      setSelected(new Set())
      setConfirmDelete(false)
      fetchProspects()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setDeleting(false)
    }
  }

  function clearFilters() {
    setSearch('')
    setFilterArea('')
    setFilterSdr('')
    setFilterStatus('')
    setFilterTemp('')
  }

  const hasFilters = search || filterArea || filterSdr || filterStatus || filterTemp
  const totalPages = Math.ceil(total / pageSize)
  const allSelected = prospects.length > 0 && selected.size === prospects.length

  // SDRs available for the TO select (same area as FROM, excluding FROM itself)
  const sdrReassignFromObj = sdrs.find(s => s.id === sdrReassignFrom)
  const sdrsForReassignTo = sdrs.filter(s =>
    s.id !== sdrReassignFrom &&
    (!sdrReassignFromObj?.area_id || s.area_id === sdrReassignFromObj.area_id)
  )

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{t('nav.prospects')}</h1>

        <div style={S.header}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)' }} />
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

          {/* SDR filter (admin only) */}
          {isAdmin && (
            <select value={filterSdr} onChange={e => setFilterSdr(e.target.value)} style={S.select}>
              <option value="">All SDRs</option>
              <option value="unassigned">Unassigned</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
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
            <button onClick={clearFilters} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <X size={12} /> {t('common.clearFilters')}
            </button>
          )}

          <div style={{ flex: 1 }} />

          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            style={{ ...S.select, fontSize: 12 }}
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>Show {n}</option>)}
          </select>

          {isAdmin && !isImpersonating && (
            <button
              onClick={() => setSdrReassignOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 6, border: '1px solid #6C63FF40', backgroundColor: '#6C63FF15', color: 'var(--crm-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              <Users size={13} /> Reassign SDR
            </button>
          )}

          <button onClick={fetchProspects} disabled={loading} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>

          <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>{t('common.leadsCount', { count: total })}</span>
        </div>

      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--crm-border)', borderRadius: 10, backgroundColor: 'var(--crm-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--crm-surface)', zIndex: 1 }}>
            <tr>
              {isAdmin && (
                <th style={{ ...S.th, width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    style={{ accentColor: 'var(--crm-accent)', cursor: 'pointer' }}
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
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isAdmin ? 14 : 12} style={{ ...S.td, textAlign: 'center', color: 'var(--crm-text-muted)', padding: 40 }}>
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!loading && prospects.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 14 : 12} style={{ ...S.td, textAlign: 'center', color: 'var(--crm-text-muted)', padding: 40 }}>
                  {t('common.noData')}
                </td>
              </tr>
            )}
            {!loading && prospects.map(p => (
              <tr
                key={p.id}
                onClick={() => { setDrawerProspect(p); setDrawerOpen(true) }}
                style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--crm-surface-raised)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {isAdmin && (
                  <td style={{ ...S.td, width: 40 }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      style={{ accentColor: 'var(--crm-accent)', cursor: 'pointer' }}
                    />
                  </td>
                )}
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: 'var(--crm-text-primary)' }}>{p.name}</div>
                  {p.title && <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 2 }}>{p.title}</div>}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)' }}>{p.company ?? '—'}</td>
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
                  {p.lead_temperature ? <TemperatureBadge temperature={p.lead_temperature} /> : <span style={{ color: 'var(--crm-text-muted)' }}>—</span>}
                </td>
                <td style={{ ...S.td, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: icpColor(p.icp_score) }}>
                  {p.icp_score !== null ? p.icp_score : '—'}
                </td>
                {isAdmin && (
                  <td style={S.td}>
                    {p.area ? <AreaBadge area={p.area} size="sm" /> : <span style={{ color: 'var(--crm-text-muted)' }}>—</span>}
                  </td>
                )}
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }}>
                  {p.assigned_user?.full_name ?? <span style={{ color: 'var(--crm-text-muted)' }}>{t('common.unassigned')}</span>}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-muted)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                  {format(new Date(p.created_at), 'MMM d, yy')}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }}>
                  {p.search_combo ?? <span style={{ color: 'var(--crm-text-muted)' }}>—</span>}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-muted)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                  {p.scrape_date ?? '—'}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }}>
                  {p.market ?? <span style={{ color: 'var(--crm-text-muted)' }}>—</span>}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }} title={p.custom1 ?? undefined}>
                  {truncate(p.custom1)}
                </td>
                <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }} title={p.custom2 ?? undefined}>
                  {truncate(p.custom2)}
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
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: page === 0 ? 'var(--crm-text-muted)' : 'var(--crm-text-primary)', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
            {t('common.page')} {page + 1} {t('common.of')} {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: page >= totalPages - 1 ? 'var(--crm-text-muted)' : 'var(--crm-text-primary)', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}
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

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) { setConfirmDelete(false); setDeleteError(null) } }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 380, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#EF444420', border: '1px solid #EF444440', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={16} color="#EF4444" />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#EF4444' }}>Delete leads</h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              Permanently delete <strong style={{ color: 'var(--crm-text-primary)' }}>{selected.size} lead{selected.size > 1 ? 's' : ''}</strong>? This action cannot be undone.
            </p>
            {deleteError && (
              <div style={{ padding: '10px 14px', backgroundColor: '#EF444415', border: '1px solid #EF444440', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#EF4444' }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => { setConfirmDelete(false); setDeleteError(null) }} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleBulkDelete}
                disabled={deleting}
                style={{ flex: 1, backgroundColor: '#EF4444', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Trash2 size={13} /> {deleting ? 'Deleting...' : `Delete ${selected.size}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed bottom action bar (admin, selection active) — bulk delete */}
      {isAdmin && !isImpersonating && selected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
          backgroundColor: '#0D0D14', borderTop: '1px solid var(--crm-border)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 13, color: 'var(--crm-text-primary)', fontWeight: 600 }}>
            {selected.size} lead{selected.size > 1 ? 's' : ''} selected
          </span>

          <div style={{ width: 1, height: 20, backgroundColor: 'var(--crm-border)' }} />

          <button
            onClick={() => setConfirmDelete(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 5, border: '1px solid #EF444440', backgroundColor: '#EF444410', color: '#EF4444', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            <Trash2 size={12} /> Delete ({selected.size})
          </button>

          <button
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 5, border: 'none', backgroundColor: 'transparent', color: 'var(--crm-text-muted)', cursor: 'pointer', fontSize: 12 }}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Reassign success toast */}
      {reassignToast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 24, zIndex: 60,
          backgroundColor: '#1A3A2A', border: '1px solid #22C55E40',
          borderRadius: 8, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: '#22C55E', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <CheckCircle size={14} />
          {reassignToast}
        </div>
      )}

      {/* SDR Reassign modal */}
      {sdrReassignOpen && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) { setSdrReassignOpen(false); setSdrReassignFrom(''); setSdrReassignTo(''); setSdrReassignCount(null); setSdrReassignLimit('') } }}
        >
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#6C63FF20', border: '1px solid #6C63FF40', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={16} color="var(--crm-accent)" />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--crm-text-primary)' }}>Reassign leads between SDRs</h2>
            </div>

            {/* FROM → TO selects */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>From</label>
                <select
                  value={sdrReassignFrom}
                  onChange={e => { setSdrReassignFrom(e.target.value); setSdrReassignTo(''); setSdrReassignLimit('') }}
                  style={{ ...S.select, width: '100%' }}
                >
                  <option value="">Select SDR...</option>
                  {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>

              <div style={{ paddingTop: 22 }}>
                <ArrowRight size={16} color="var(--crm-text-muted)" />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>To</label>
                <select
                  value={sdrReassignTo}
                  onChange={e => setSdrReassignTo(e.target.value)}
                  disabled={!sdrReassignFrom}
                  style={{ ...S.select, width: '100%', opacity: sdrReassignFrom ? 1 : 0.5 }}
                >
                  <option value="">Select SDR...</option>
                  {sdrsForReassignTo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
            </div>

            {/* Quantity input */}
            {sdrReassignFrom && sdrReassignCount !== null && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                  Leads to reassign
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min={1}
                    max={sdrReassignCount}
                    value={sdrReassignLimit}
                    onChange={e => setSdrReassignLimit(e.target.value)}
                    placeholder={`All (${sdrReassignCount})`}
                    style={{ ...S.input, padding: '7px 10px', width: 140, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>of {sdrReassignCount} available</span>
                </div>
              </div>
            )}

            {/* Transfer preview */}
            {sdrReassignFrom && sdrReassignCount !== null && (
              <div style={{ padding: '10px 14px', backgroundColor: '#6C63FF10', border: '1px solid #6C63FF30', borderRadius: 8, marginBottom: 20, fontSize: 13, color: 'var(--crm-text-secondary)' }}>
                {(() => {
                  const n = sdrReassignLimit && Number(sdrReassignLimit) > 0
                    ? Math.min(Number(sdrReassignLimit), sdrReassignCount)
                    : sdrReassignCount
                  const toSdr = sdrs.find(s => s.id === sdrReassignTo)
                  return <>
                    <strong style={{ color: 'var(--crm-accent)' }}>{n}</strong> lead{n !== 1 ? 's' : ''} will be reassigned
                    {toSdr && <> to <strong style={{ color: 'var(--crm-text-primary)' }}>{toSdr.full_name}</strong></>}
                  </>
                })()}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                onClick={() => { setSdrReassignOpen(false); setSdrReassignFrom(''); setSdrReassignTo(''); setSdrReassignCount(null); setSdrReassignLimit('') }}
                style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSdrReassign}
                disabled={!sdrReassignFrom || !sdrReassignTo || sdrReassigning || sdrReassignCount === 0 || (sdrReassignLimit !== '' && Number(sdrReassignLimit) <= 0)}
                style={{ flex: 1, backgroundColor: 'var(--crm-accent)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {sdrReassigning ? 'Reassigning...' : 'Confirm reassignment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
