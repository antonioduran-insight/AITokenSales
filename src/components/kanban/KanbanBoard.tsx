'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core'
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

interface PipelineStage {
  name: string
  color: string
  outreach_status: OutreachStatus
}

export function KanbanBoard() {
  const { user } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin } = useOrgId()
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

  const isSdr = user?.role === 'sdr'
  const sdrAreaIds = sdrAreas.map(a => a.id)

  // Single init effect: fetch meta (areas, stages) and prospects in parallel.
  // Avoids the cascade where sdrAreas state change would trigger a second prospects fetch.
  useEffect(() => {
    if (!user && !isImpersonating) return

    const supabase = createClient()
    setLoading(true)

    async function init() {
      // Phase 1 — all meta queries in parallel
      const [areasRes, sdrAreasRes, stagesRes, orgSdrsRes] = await Promise.all([
        isAdmin
          ? supabase.from('areas').select('*').order('name')
          : Promise.resolve({ data: null }),
        user?.role === 'sdr'
          ? supabase.from('user_areas').select('area:areas(*)').eq('user_id', user.id)
          : Promise.resolve({ data: null }),
        !isImpersonating
          ? supabase.from('pipeline_stages').select('name, color, outreach_status')
          : Promise.resolve({ data: null }),
        isAdmin
          ? supabase.from('users').select('id, full_name').eq('role', 'sdr').eq('is_active', true).order('full_name')
          : Promise.resolve({ data: null }),
      ])

      if (areasRes.data) setAreas(areasRes.data as Area[])
      if (orgSdrsRes.data) setOrgSdrs(orgSdrsRes.data as { id: string; full_name: string }[])

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
          const res = await fetch(
            `/api/crm/prospects?impersonate_org_id=${impersonateOrgId}&select=${encodeURIComponent(PROSPECT_SELECT)}&limit=1000`
          )
          const json = await res.json()
          data = (json.data ?? []) as Prospect[]
        } else {
          let query = supabase
            .from('prospects')
            .select(PROSPECT_SELECT)
            .order('created_at', { ascending: false })
          if (user?.role === 'sdr') {
            const ids = resolvedSdrAreas.map(a => a.id)
            if (ids.length === 1) query = query.eq('area_id', ids[0])
            else if (ids.length > 1) query = query.in('area_id', ids)
            else if (user.area_id) query = query.eq('area_id', user.area_id)
          }
          const { data: rows } = await query
          data = (rows ?? []) as unknown as Prospect[]
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
        const res = await fetch(
          `/api/crm/prospects?impersonate_org_id=${impersonateOrgId}&select=${encodeURIComponent(PROSPECT_SELECT)}&limit=1000`
        )
        const json = await res.json()
        data = (json.data ?? []) as Prospect[]
      } else {
        const supabase = createClient()
        let query = supabase
          .from('prospects')
          .select(PROSPECT_SELECT)
          .order('created_at', { ascending: false })
        if (isAdmin) {
          if (selectedAreaId) query = query.eq('area_id', selectedAreaId)
        } else if (isSdr) {
          const filterIds = selectedAreaId ? [selectedAreaId] : sdrAreaIds
          if (filterIds.length === 1) query = query.eq('area_id', filterIds[0])
          else if (filterIds.length > 1) query = query.in('area_id', filterIds)
          else if (user?.area_id) query = query.eq('area_id', user.area_id)
        }
        const { data: rows } = await query
        data = (rows ?? []) as unknown as Prospect[]
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

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingId(active.id as string)
  }

  async function commitStatusChange(prospect: Prospect, newStatus: OutreachStatus, prevStatus: OutreachStatus) {
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
    // landed instead of just disappearing and reappearing (F13).
    setRecentlyMovedId(prospect.id)
    if (recentlyMovedTimeoutRef.current) clearTimeout(recentlyMovedTimeoutRef.current)
    recentlyMovedTimeoutRef.current = setTimeout(() => setRecentlyMovedId(null), 1800)

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
    if (!over || isImpersonating) return

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
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--crm-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          backgroundColor: 'var(--crm-surface)',
        }}
      >
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
            }}
          >
            <option value="">{t('convertidos.allSdrs')}</option>
            {orgSdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        )}

        <div style={{ flex: 1 }} />

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

        {!isImpersonating && (
          <Button
            onClick={() => setFormOpen(true)}
            style={{ backgroundColor: 'var(--crm-accent)', color: 'var(--crm-text-primary)', fontSize: 13, height: 34, gap: 6, display: 'flex', alignItems: 'center' }}
          >
            <Plus size={14} />
            {t('prospect.new')}
          </Button>
        )}
      </div>

      {/* Columns */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 16px 0' }}>
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
