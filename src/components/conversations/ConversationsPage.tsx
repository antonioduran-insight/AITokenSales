'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { ProspectDrawer } from '@/components/prospects/ProspectDrawer'
import { format } from 'date-fns'
import { MessageSquare, Search, X, RefreshCw } from 'lucide-react'
import type { Conversation, Area, User, Prospect } from '@/lib/types'

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px 7px 32px', fontSize: 13, width: 220, outline: 'none' },
  select: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px', fontSize: 13 },
  card: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s' },
}

const CONV_SELECT = '*,author:users!author_id(id,full_name,email,role,area_id,is_active,created_at),prospect:prospects!prospect_id(id,name,company,title,outreach_status,lead_temperature,area_id,assigned_to,linkedin_url,email,icp_score,custom1,custom2,custom3,source,created_at,updated_at,market,search_combo,scrape_date,industry,company_size,flag_tomorrow,created_by,area:areas(*),assigned_user:users!assigned_to(id,full_name,email,role,area_id,is_active,created_at))'

export function ConversationsPage() {
  const { user, isAdmin } = useUser()
  const { isImpersonating, impersonateOrgId } = useOrgId()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [areas, setAreas] = useState<Area[]>([])
  const [sdrs, setSdrs] = useState<User[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterSdr, setFilterSdr] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  // View full modal
  const [viewFull, setViewFull] = useState<Conversation | null>(null)

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

  const fetchConversations = useCallback(async () => {
    if (!user && !isImpersonating) return
    setLoading(true)
    try {
      let results: Conversation[] = []

      if (isImpersonating && impersonateOrgId) {
        const params = new URLSearchParams({ impersonate_org_id: impersonateOrgId, select: CONV_SELECT, limit: '1000' })
        const res = await fetch(`/api/crm/conversations?${params}`)
        const json = await res.json()
        results = (json.data ?? []) as unknown as Conversation[]
      } else {
        let query = createClient()
          .from('conversations')
          .select(CONV_SELECT, { count: 'exact' })
          .order('created_at', { ascending: false })

        if (filterSdr) query = query.eq('author_id', filterSdr)
        if (filterFrom) query = query.gte('created_at', filterFrom)
        if (filterTo) query = query.lte('created_at', filterTo + 'T23:59:59')

        const { data, count } = await query
        results = (data ?? []) as unknown as Conversation[]
        setTotal(count ?? results.length)
      }

      // Client-side filters
      if (filterFrom) results = results.filter(c => c.created_at >= filterFrom)
      if (filterTo) results = results.filter(c => c.created_at <= filterTo + 'T23:59:59')
      if (search.trim()) {
        const q = search.toLowerCase()
        results = results.filter(c =>
          (c.prospect as { name?: string })?.name?.toLowerCase().includes(q) ||
          c.reason.toLowerCase().includes(q)
        )
      }
      if (filterArea) results = results.filter(c => (c.prospect as { area_id?: string })?.area_id === filterArea)
      if (isImpersonating && filterSdr) results = results.filter(c => (c.author as { id?: string })?.id === filterSdr)

      setConversations(results)
      if (isImpersonating) setTotal(results.length)
    } finally {
      setLoading(false)
    }
  }, [user, filterSdr, filterFrom, filterTo, search, filterArea, isImpersonating, impersonateOrgId])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  function clearFilters() {
    setSearch(''); setFilterArea(''); setFilterSdr(''); setFilterFrom(''); setFilterTo('')
  }

  const hasFilters = search || filterArea || filterSdr || filterFrom || filterTo

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <MessageSquare size={20} color="#6C63FF" />
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Conversations</h1>
          <span style={{ fontSize: 12, color: '#52526A', marginLeft: 4 }}>{total} total</span>
        </div>

        <div style={S.header}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#52526A' }} />
            <input
              style={S.input}
              placeholder="Search by prospect or reason…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Area filter (admin) */}
          {isAdmin && (
            <select value={filterArea} onChange={e => setFilterArea(e.target.value)} style={S.select}>
              <option value="">All Areas</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.label_en}</option>)}
            </select>
          )}

          {/* SDR filter (admin) */}
          {isAdmin && (
            <select value={filterSdr} onChange={e => setFilterSdr(e.target.value)} style={S.select}>
              <option value="">All SDRs</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}

          {/* Date range */}
          <input
            type="date"
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            style={{ ...S.select, colorScheme: 'dark' }}
            title="Desde"
          />
          <input
            type="date"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            style={{ ...S.select, colorScheme: 'dark' }}
            title="Hasta"
          />

          {hasFilters && (
            <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', fontSize: 12 }}>
              <X size={12} /> Clear
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button onClick={fetchConversations} disabled={loading} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ textAlign: 'center', color: '#52526A', padding: 40 }}>Loading…</div>
        )}
        {!loading && conversations.length === 0 && (
          <div style={{ textAlign: 'center', color: '#52526A', padding: 40 }}>No conversations</div>
        )}
        {!loading && conversations.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {conversations.map(c => {
              const prospect = c.prospect as (Prospect & { area?: Area; assigned_user?: User }) | undefined
              const author = c.author as User | undefined

              return (
                <div
                  key={c.id}
                  style={S.card}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#6C63FF40')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A3A')}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    {/* Prospect name */}
                    <button
                      onClick={() => {
                        if (prospect) {
                          setDrawerProspect(prospect as unknown as Prospect)
                          setDrawerOpen(true)
                        }
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F5' }}>
                        {prospect?.name ?? '—'}
                      </div>
                      {prospect?.company && (
                        <div style={{ fontSize: 12, color: '#52526A', marginTop: 2 }}>{prospect.company}</div>
                      )}
                    </button>

                    {/* Meta */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: '#8B8BA0', fontWeight: 500 }}>{author?.full_name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: '#52526A', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                        {format(new Date(c.created_at), 'dd MMM yyyy, HH:mm')}
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div style={{ fontSize: 12, color: '#6C63FF', fontStyle: 'italic', marginBottom: 8, padding: '4px 8px', backgroundColor: '#6C63FF10', borderRadius: 4, display: 'inline-block' }}>
                    {c.reason}
                  </div>

                  {/* Chat preview */}
                  <div style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.5 }}>
                    {c.chat_content.length > 100 ? c.chat_content.slice(0, 100) + '…' : c.chat_content}
                  </div>

                  {c.chat_content.length > 100 && (
                    <button
                      onClick={e => { e.stopPropagation(); setViewFull(c) }}
                      style={{ marginTop: 8, fontSize: 12, color: '#6C63FF', background: 'none', border: '1px solid #6C63FF30', borderRadius: 5, cursor: 'pointer', padding: '3px 10px' }}
                    >
                      View full
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* View full modal */}
      {viewFull && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) setViewFull(null) }}
        >
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 640, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F5' }}>
                  {(viewFull.prospect as { name?: string })?.name ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: '#52526A', marginTop: 2 }}>
                  {(viewFull.author as User | undefined)?.full_name} · {format(new Date(viewFull.created_at), 'dd MMM yyyy, HH:mm')}
                </div>
              </div>
              <button onClick={() => setViewFull(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A', flexShrink: 0 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6C63FF', fontStyle: 'italic', marginBottom: 14, padding: '6px 10px', backgroundColor: '#6C63FF10', borderRadius: 6 }}>
              "{viewFull.reason}"
            </div>
            <div style={{ fontSize: 13, color: '#F0F0F5', lineHeight: 1.7, whiteSpace: 'pre-wrap', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 8, padding: '12px 14px' }}>
              {viewFull.chat_content}
            </div>
          </div>
        </div>
      )}

      {/* Prospect drawer */}
      {drawerProspect && (
        <ProspectDrawer
          prospect={drawerProspect}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setDrawerProspect(null) }}
          onUpdated={updated => setDrawerProspect(updated)}
        />
      )}
    </div>
  )
}
