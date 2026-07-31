'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { useTranslations } from 'next-intl'
import { KanbanColumn } from './KanbanColumn'
import { ProspectCard } from './ProspectCard'
import { ProspectDrawer } from '@/components/prospects/ProspectDrawer'
import { ProspectForm } from '@/components/prospects/ProspectForm'
import { CloseDealModal } from '@/components/conversations/CloseDealModal'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Prospect, OutreachStatus, Area } from '@/lib/types'
import { OUTREACH_STATUSES } from '@/lib/types'

const PROSPECT_SELECT = '*, area:areas(*), assigned_user:users!assigned_to(id, full_name, email, role, area_id, is_active, created_at)'

// PostgREST caps every response at 1000 rows and gives NO signal when it
// truncates — no error, no flag, just a short array. The Kanban read straight
// into `setProspects()` with no range, so an org past 1000 prospects silently
// rendered an incomplete board: cards simply missing, no way for anyone to
// notice. AITokenSales crossed that line (1033 prospects) while this was
// unpaginated, so this was already happening in production, not a hypothetical.
//
// A board can't be paginated the way the Leads table is — every column needs
// its full set to be meaningful — so the fix is to page through server-side
// and reassemble the whole list, not to expose page controls.
const FETCH_PAGE = 1000
const FETCH_HARD_CAP = 20000

async function fetchAllProspects(
  fetchPage: (offset: number, limit: number) => Promise<{ data: Prospect[]; count?: number | null }>
): Promise<Prospect[]> {
  const first = await fetchPage(0, FETCH_PAGE)
  const all: Prospect[] = [...first.data]

  // Every call site now asks for an exact count on page 1, so once an org
  // crosses FETCH_PAGE prospects (already true here — 1033), the remaining
  // pages can fire in parallel instead of one sequential round trip at a
  // time. That sequential wait used to sit directly in front of the first
  // paint of the board.
  if (first.count != null) {
    const total = Math.min(first.count, FETCH_HARD_CAP)
    const remainingOffsets: number[] = []
    for (let offset = FETCH_PAGE; offset < total; offset += FETCH_PAGE) remainingOffsets.push(offset)
    if (remainingOffsets.length > 0) {
      const pages = await Promise.all(remainingOffsets.map(offset => fetchPage(offset, FETCH_PAGE)))
      pages.forEach(p => all.push(...p.data))
    }
    if (first.count > FETCH_HARD_CAP) {
      console.warn(`[Kanban] stopped at ${FETCH_HARD_CAP} prospects — the board is showing a partial set.`)
    }
    return all
  }

  // Fallback for a fetcher that couldn't report a count: page sequentially
  // until a short batch signals the end, same as before.
  if (first.data.length === FETCH_PAGE) {
    for (let offset = FETCH_PAGE; ; offset += FETCH_PAGE) {
      const batch = await fetchPage(offset, FETCH_PAGE)
      all.push(...batch.data)
      if (batch.data.length < FETCH_PAGE) break
      if (all.length >= FETCH_HARD_CAP) {
        console.warn(`[Kanban] stopped at ${FETCH_HARD_CAP} prospects — the board is showing a partial set.`)
        break
      }
    }
  }
  return all
}

interface PipelineStage {
  name: string
  color: string
  outreach_status: OutreachStatus
}

export function KanbanBoard() {
  const { user } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin, isReadOnly } = useOrgId()
  const t = useTranslations()

  const [prospects, setProspects] = useState<Prospect[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [sdrAreas, setSdrAreas] = useState<Area[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  // Admin-only: view one SDR's individual board instead of the consolidated one (FUNC-S2).
  const [orgSdrs, setOrgSdrs] = useState<{ id: string; full_name: string }[]>([])
  const [selectedSdrId, setSelectedSdrId] = useState<string | null>(null)
  const [activeProspect, setActiveProspect] = useState<Prospect | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stageMap, setStageMap] = useState<Map<OutreachStatus, PipelineStage>>(new Map())
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({})
  const [pendingClose, setPendingClose] = useState<{ prospect: Prospect; prevStatus: OutreachStatus } | null>(null)
  const [closingSaving, setClosingSaving] = useState(false)
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null)
  const recentlyMovedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialMount = useRef(true)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setCardRef = useCallback((id: string, node: HTMLDivElement | null) => {
    cardRefs.current[id] = node
  }, [])

  const isSdr = user?.role === 'sdr'
  const sdrAreaIds = sdrAreas.map(a => a.id)

  // A short activation distance means a drag only starts once the pointer
  // has actually moved a few px — without it, a touch tap (which always
  // wobbles a little) could misfire as a drag instead of opening the card,
  // and on touch a drag competes with the column list's own horizontal
  // scroll gesture until it's clear the user means to drag, not swipe.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Single init effect: fetch meta (areas, stages) and prospects in parallel.
  // Avoids the cascade where sdrAreas state change would trigger a second prospects fetch.
  useEffect(() => {
    if (!user && !isImpersonating) return

    const supabase = createClient()
    setLoading(true)

    // SDR list behind the admin-only "view one SDR's board" picker.
    // Must be scoped by organization explicitly and routed through the
    // impersonation proxy, exactly like the prospects queries below — leaving
    // it on the browser client with no `organization_id` filter leaked every
    // other org's SDR names + UUIDs into the dropdown for `admin_global`
    // (whose RLS on `users` is cross-org): impersonating an org with zero
    // seats still listed 12 people from two other orgs.
    async function fetchOrgSdrs(): Promise<{ id: string; full_name: string }[]> {
      if (!isAdmin) return []

      if (isImpersonating) {
        if (!impersonateOrgId) return []
        // /api/crm/[table] scopes to the impersonated org server-side but has
        // no role/is_active filter, so those two are applied here.
        const params = new URLSearchParams({
          impersonate_org_id: impersonateOrgId,
          select: 'id, full_name, role, is_active',
          order: 'full_name',
          order_dir: 'asc',
        })
        const res = await fetch(`/api/crm/users?${params}`)
        if (!res.ok) return []
        const json = await res.json()
        return ((json.data ?? []) as { id: string; full_name: string; role: string; is_active: boolean }[])
          .filter(u => u.role === 'sdr' && u.is_active)
          .map(u => ({ id: u.id, full_name: u.full_name }))
      }

      if (!user?.organization_id) return []
      const { data } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('organization_id', user.organization_id)
        .eq('role', 'sdr')
        .eq('is_active', true)
        .order('full_name')
      return (data ?? []) as { id: string; full_name: string }[]
    }

    async function init() {
      // Phase 1 — all meta queries in parallel
      const [areasRes, sdrAreasRes, stagesRes, orgSdrsList] = await Promise.all([
        isAdmin
          ? supabase.from('areas').select('*').order('name')
          : Promise.resolve({ data: null }),
        user?.role === 'sdr'
          ? supabase.from('user_areas').select('area:areas(*)').eq('user_id', user.id)
          : Promise.resolve({ data: null }),
        !isImpersonating
          ? supabase.from('pipeline_stages').select('name, color, outreach_status')
          : Promise.resolve({ data: null }),
        fetchOrgSdrs(),
      ])

      if (areasRes.data) setAreas(areasRes.data as Area[])
      setOrgSdrs(orgSdrsList)

      // Resolve SDR areas locally so prospects query doesn't need a re-render
      let resolvedSdrAreas: Area[] = []
      if (sdrAreasRes.data && sdrAreasRes.data.length > 0) {
        resolvedSdrAreas = sdrAreasRes.data
          .map(ua => (ua as unknown as { area: Area }).area)
          .filter(Boolean)
        setSdrAreas(resolvedSdrAreas)
      } else if (user?.role === 'sdr' && user.area_id) {
        const { data: aData } = await supabase.from('areas').select('*').eq('id', user.area_id)
        if (aData) { resolvedSdrAreas = aData as Area[]; setSdrAreas(aData as Area[]) }
      }

      if (stagesRes.data && stagesRes.data.length > 0) {
        const map = new Map<OutreachStatus, PipelineStage>()
        stagesRes.data.forEach(s => map.set((s as PipelineStage).outreach_status, s as PipelineStage))
        setStageMap(map)
      }

      // Phase 2 — prospects (uses resolved SDR areas, no extra round-trip)
      try {
        let data: Prospect[] = []
        if (isImpersonating && impersonateOrgId) {
          data = await fetchAllProspects(async (offset, limit) => {
            const res = await fetch(
              `/api/crm/prospects?impersonate_org_id=${impersonateOrgId}&select=${encodeURIComponent(PROSPECT_SELECT)}&limit=${limit}&offset=${offset}`
            )
            const json = await res.json()
            return { data: (json.data ?? []) as Prospect[], count: json.count ?? null }
          })
        } else {
          data = await fetchAllProspects(async (offset, limit) => {
            let query = supabase
              .from('prospects')
              .select(PROSPECT_SELECT, { count: 'exact' })
              .order('created_at', { ascending: false })
              .range(offset, offset + limit - 1)
            if (user?.role === 'sdr') {
              const ids = resolvedSdrAreas.map(a => a.id)
              if (ids.length === 1) query = query.eq('area_id', ids[0])
              else if (ids.length > 1) query = query.in('area_id', ids)
              else if (user.area_id) query = query.eq('area_id', user.area_id)
            }
            const { data: rows, count } = await query
            return { data: (rows ?? []) as unknown as Prospect[], count: count ?? null }
          })
        }
        setProspects(data)
      } finally {
        setLoading(false)
      }
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin, isImpersonating, impersonateOrgId])

  // fetchProspects used for manual refresh and area filter changes
  const fetchProspects = useCallback(async () => {
    if (!isAdmin && !isSdr && !isImpersonating) return
    setLoading(true)
    try {
      let data: Prospect[] = []
      if (isImpersonating && impersonateOrgId) {
        data = await fetchAllProspects(async (offset, limit) => {
          const res = await fetch(
            `/api/crm/prospects?impersonate_org_id=${impersonateOrgId}&select=${encodeURIComponent(PROSPECT_SELECT)}&limit=${limit}&offset=${offset}`
          )
          const json = await res.json()
          return { data: (json.data ?? []) as Prospect[], count: json.count ?? null }
        })
      } else {
        const supabase = createClient()
        data = await fetchAllProspects(async (offset, limit) => {
          let query = supabase
            .from('prospects')
            .select(PROSPECT_SELECT, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)
          if (isAdmin) {
            if (selectedAreaId) query = query.eq('area_id', selectedAreaId)
          } else if (isSdr) {
            const filterIds = selectedAreaId ? [selectedAreaId] : sdrAreaIds
            if (filterIds.length === 1) query = query.eq('area_id', filterIds[0])
            else if (filterIds.length > 1) query = query.in('area_id', filterIds)
            else if (user?.area_id) query = query.eq('area_id', user.area_id)
          }
          const { data: rows, count } = await query
          return { data: (rows ?? []) as unknown as Prospect[], count: count ?? null }
        })
      }
      setProspects(data)
    } finally {
      setLoading(false)
    }
  }, [selectedAreaId, isAdmin, isSdr, isImpersonating, impersonateOrgId, user, sdrAreaIds])

  // Re-fetch when area filter changes (not on initial load — init handles that)
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return }
    fetchProspects().catch(console.error)
  }, [selectedAreaId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Chat counts for closed prospects — drives the "Missing conversation" badge.
  const closedIds = prospects.filter(p => p.outreach_status === 'closed').map(p => p.id).sort().join(',')
  useEffect(() => {
    if (!closedIds) { setChatCounts({}); return }
    const url = isImpersonating && impersonateOrgId
      ? `/api/conversations/counts?ids=${closedIds}&impersonate_org_id=${impersonateOrgId}`
      : `/api/conversations/counts?ids=${closedIds}`
    fetch(url).then(r => r.json()).then(setChatCounts).catch(() => {})
  }, [closedIds, isImpersonating, impersonateOrgId])

  // Scroll the moved card into view — commitStatusChange doesn't reorder
  // `prospects`, so the card can land anywhere in its new column (including
  // fully outside the current scroll position in a long column), making the
  // highlight itself invisible without this. Runs after the re-render that
  // moved the card's ProspectCard instance into its new column, so the ref
  // in cardRefs already points at the new node by the time this fires.
  useEffect(() => {
    if (!recentlyMovedId) return
    cardRefs.current[recentlyMovedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [recentlyMovedId])

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingId(active.id as string)
  }

  async function commitStatusChange(prospect: Prospect, newStatus: OutreachStatus, prevStatus: OutreachStatus) {
    // Belt-and-braces: every caller is already gated, but this is the single
    // place that actually writes a status, so it refuses in read-only mode too.
    if (isReadOnly) return false

    setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, outreach_status: newStatus } : p))

    const supabase = createClient()
    const { error } = await supabase
      .from('prospects')
      .update({ outreach_status: newStatus })
      .eq('id', prospect.id)

    if (error) {
      setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, outreach_status: prevStatus } : p))
      return false
    }

    // Transient highlight on the card's new column so it's clear where it
    // landed instead of just disappearing and reappearing (F13). Scrolling
    // it into view (below, via the recentlyMovedId effect) is what actually
    // makes this visible in a long column — the highlight alone did nothing
    // if the card landed outside the current scroll position.
    setRecentlyMovedId(prospect.id)
    if (recentlyMovedTimeoutRef.current) clearTimeout(recentlyMovedTimeoutRef.current)
    recentlyMovedTimeoutRef.current = setTimeout(() => setRecentlyMovedId(null), 2200)

    await logAuditEvent({
      event_type: 'status_changed',
      prospect_id: prospect.id,
      prospect_name: prospect.name,
      metadata: { from_status: prevStatus, to_status: newStatus },
    })
    return true
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null)
    // isReadOnly, not isImpersonating — an admin_global on a bare /kanban URL
    // (no ?impersonate_org_id=) is not impersonating and could drag other orgs'
    // cards between columns, writing to prospects.outreach_status for real.
    if (!over || isReadOnly) return

    const newStatus = over.id as OutreachStatus
    const prospect = prospects.find(p => p.id === active.id)
    if (!prospect || prospect.outreach_status === newStatus) return

    const prevStatus = prospect.outreach_status

    // Moving to Closed is gated behind the mandatory chat-upload modal — the
    // status isn't committed until the modal resolves (Save or Skip).
    if (newStatus === 'closed') {
      setPendingClose({ prospect, prevStatus })
      return
    }

    await commitStatusChange(prospect, newStatus, prevStatus)
  }

  async function handleCloseSave(chatContent: string) {
    if (!pendingClose) return
    setClosingSaving(true)
    const { prospect, prevStatus } = pendingClose
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospect.id, chat_content: chatContent, reason: 'Uploaded at close' }),
      })
      if (!res.ok) return

      await logAuditEvent({
        event_type: 'conversation_added',
        prospect_id: prospect.id,
        prospect_name: prospect.name,
        metadata: { source: 'kanban_close' },
      })
      const ok = await commitStatusChange(prospect, 'closed', prevStatus)
      if (ok) {
        setChatCounts(prev => ({ ...prev, [prospect.id]: (prev[prospect.id] ?? 0) + 1 }))
        setPendingClose(null)
      }
    } finally {
      setClosingSaving(false)
    }
  }

  async function handleCloseSkip() {
    if (!pendingClose) return
    setClosingSaving(true)
    const { prospect, prevStatus } = pendingClose
    try {
      const ok = await commitStatusChange(prospect, 'closed', prevStatus)
      if (ok) setPendingClose(null)
    } finally {
      setClosingSaving(false)
    }
  }

  function handleCloseCancel() {
    setPendingClose(null)
  }

  function handleCardClick(prospect: Prospect) {
    setActiveProspect(prospect)
    setDrawerOpen(true)
  }

  function handleDrawerClose() {
    setDrawerOpen(false)
    setActiveProspect(null)
  }

  function handleProspectUpdated(updated: Prospect) {
    setProspects(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
    setActiveProspect(updated)
  }

  function handleProspectCreated() {
    setFormOpen(false)
    fetchProspects()
  }

  const draggingProspect = draggingId ? prospects.find(p => p.id === draggingId) : null
  const currentArea = areas.find(a => a.id === selectedAreaId) ?? sdrAreas[0] ?? user?.area

  const visibleProspects = (isImpersonating && selectedAreaId
    ? prospects.filter(p => p.area_id === selectedAreaId)
    : prospects
  ).filter(p => !selectedSdrId || p.assigned_to === selectedSdrId)

  const filterAreas = isAdmin ? areas : (isSdr ? sdrAreas : [])
  const showAreaFilter = filterAreas.length > 0

  const defaultAreaForForm = selectedAreaId ?? (isSdr && sdrAreaIds.length === 1 ? sdrAreaIds[0] : undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header — two groups (filters / actions) so it wraps to a second
          line as a whole on narrow screens instead of overflowing, or the
          actions group getting squeezed against a flex:1 spacer that doesn't
          make sense once the row wraps. */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--crm-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          rowGap: 10,
          gap: 12,
          flexShrink: 0,
          backgroundColor: 'var(--crm-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {showAreaFilter ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => setSelectedAreaId(null)}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid',
                  borderColor: selectedAreaId === null ? 'var(--crm-accent)' : 'var(--crm-border)',
                  backgroundColor: selectedAreaId === null ? '#6C63FF20' : 'transparent',
                  color: selectedAreaId === null ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {t('areas.all')}
              </button>
              {filterAreas.map(area => (
                <button
                  key={area.id}
                  onClick={() => setSelectedAreaId(area.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid',
                    borderColor: selectedAreaId === area.id ? 'var(--crm-accent)' : 'var(--crm-border)',
                    backgroundColor: selectedAreaId === area.id ? '#6C63FF20' : 'transparent',
                    color: selectedAreaId === area.id ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
                    fontSize: 12, fontWeight: 600, cursor: area.is_active ? 'pointer' : 'not-allowed',
                    opacity: area.is_active ? 1 : 0.4,
                  }}
                  disabled={!area.is_active}
                >
                  {area.label_en}
                </button>
              ))}
            </div>
          ) : (
            currentArea && <AreaBadge area={currentArea as Area} size="md" />
          )}

          {isAdmin && orgSdrs.length > 0 && (
            <select
              value={selectedSdrId ?? ''}
              onChange={e => setSelectedSdrId(e.target.value || null)}
              style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--crm-border)',
                backgroundColor: selectedSdrId ? '#6C63FF20' : 'transparent',
                color: selectedSdrId ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                maxWidth: '100%',
              }}
            >
              <option value="">{t('convertidos.allSdrs')}</option>
              {orgSdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={fetchProspects}
            disabled={loading}
            style={{
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--crm-border)',
              backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>

          {!isReadOnly && (
            <Button
              onClick={() => setFormOpen(true)}
              style={{ backgroundColor: 'var(--crm-accent)', color: 'var(--crm-text-primary)', fontSize: 13, height: 34, gap: 6, display: 'flex', alignItems: 'center' }}
            >
              <Plus size={14} />
              {t('prospect.new')}
            </Button>
          )}
        </div>
      </div>

      {/* Columns — horizontal scroll/swipe between them on phone, same as desktop scroll-with-a-mouse-wheel */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 16px 0', WebkitOverflowScrolling: 'touch' }}>
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 12, height: '100%', minWidth: 'max-content' }}>
            {OUTREACH_STATUSES.map(status => {
              const stage = stageMap.get(status)
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  label={stage?.name}
                  color={stage?.color}
                  prospects={visibleProspects.filter(p => p.outreach_status === status)}
                  onCardClick={handleCardClick}
                  chatCounts={status === 'closed' ? chatCounts : undefined}
                  recentlyMovedId={recentlyMovedId}
                  setCardRef={setCardRef}
                />
              )
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingProspect && (
              <ProspectCard
                prospect={draggingProspect}
                onClick={() => {}}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {activeProspect && (
        <ProspectDrawer
          prospect={activeProspect}
          open={drawerOpen}
          onClose={handleDrawerClose}
          onUpdated={handleProspectUpdated}
        />
      )}

      <ProspectForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={handleProspectCreated}
        defaultAreaId={defaultAreaForForm}
      />

      <CloseDealModal
        open={!!pendingClose}
        prospectName={pendingClose?.prospect.name ?? ''}
        saving={closingSaving}
        onSave={handleCloseSave}
        onSkip={handleCloseSkip}
        onCancel={handleCloseCancel}
      />
    </div>
  )
}
