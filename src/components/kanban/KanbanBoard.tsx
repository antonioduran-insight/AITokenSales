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
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Prospect, OutreachStatus, Area } from '@/lib/types'
import { OUTREACH_STATUSES } from '@/lib/types'

const PROSPECT_SELECT = '*, area:areas(*), assigned_user:users!assigned_to(id, full_name, email, role, area_id, is_active, created_at)'

interface PipelineStage {
  name: string
  color: string
  position: number
}

export function KanbanBoard() {
  const { user } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin } = useOrgId()
  const t = useTranslations()

  const [prospects, setProspects] = useState<Prospect[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [sdrAreas, setSdrAreas] = useState<Area[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [activeProspect, setActiveProspect] = useState<Prospect | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stageMap, setStageMap] = useState<Map<number, PipelineStage>>(new Map())
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
      const [areasRes, sdrAreasRes, stagesRes] = await Promise.all([
        isAdmin
          ? supabase.from('areas').select('*').order('name')
          : Promise.resolve({ data: null }),
        user?.role === 'sdr'
          ? supabase.from('user_areas').select('area:areas(*)').eq('user_id', user.id)
          : Promise.resolve({ data: null }),
        !isImpersonating
          ? supabase.from('pipeline_stages').select('name, color, position').order('position')
          : Promise.resolve({ data: null }),
      ])

      if (areasRes.data) setAreas(areasRes.data as Area[])

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
        const map = new Map<number, PipelineStage>()
        stagesRes.data.forEach(s => map.set(s.position, s as PipelineStage))
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

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingId(active.id as string)
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null)
    if (!over || isImpersonating) return

    const newStatus = over.id as OutreachStatus
    const prospect = prospects.find(p => p.id === active.id)
    if (!prospect || prospect.outreach_status === newStatus) return

    const prevStatus = prospect.outreach_status
    setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, outreach_status: newStatus } : p))

    const supabase = createClient()
    const { error } = await supabase
      .from('prospects')
      .update({ outreach_status: newStatus })
      .eq('id', prospect.id)

    if (error) {
      setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, outreach_status: prevStatus } : p))
      return
    }

    await logAuditEvent({
      event_type: 'status_changed',
      prospect_id: prospect.id,
      prospect_name: prospect.name,
      metadata: { from_status: prevStatus, to_status: newStatus },
    })
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

  const visibleProspects = isImpersonating && selectedAreaId
    ? prospects.filter(p => p.area_id === selectedAreaId)
    : prospects

  const filterAreas = isAdmin ? areas : (isSdr ? sdrAreas : [])
  const showAreaFilter = filterAreas.length > 0

  const defaultAreaForForm = selectedAreaId ?? (isSdr && sdrAreaIds.length === 1 ? sdrAreaIds[0] : undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #2A2A3A',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          backgroundColor: '#13131A',
        }}
      >
        {showAreaFilter ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => setSelectedAreaId(null)}
              style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid',
                borderColor: selectedAreaId === null ? '#6C63FF' : '#2A2A3A',
                backgroundColor: selectedAreaId === null ? '#6C63FF20' : 'transparent',
                color: selectedAreaId === null ? '#6C63FF' : '#8B8BA0',
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
                  borderColor: selectedAreaId === area.id ? '#6C63FF' : '#2A2A3A',
                  backgroundColor: selectedAreaId === area.id ? '#6C63FF20' : 'transparent',
                  color: selectedAreaId === area.id ? '#6C63FF' : '#8B8BA0',
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

        <div style={{ flex: 1 }} />

        <button
          onClick={fetchProspects}
          disabled={loading}
          style={{
            padding: '6px 8px', borderRadius: 6, border: '1px solid #2A2A3A',
            backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer',
            display: 'flex', alignItems: 'center',
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>

        {!isImpersonating && (
          <Button
            onClick={() => setFormOpen(true)}
            style={{ backgroundColor: '#6C63FF', color: '#F0F0F5', fontSize: 13, height: 34, gap: 6, display: 'flex', alignItems: 'center' }}
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
            {OUTREACH_STATUSES.map((status, i) => {
              const stage = stageMap.get(i + 1)
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  label={stage?.name}
                  color={stage?.color}
                  prospects={visibleProspects.filter(p => p.outreach_status === status)}
                  onCardClick={handleCardClick}
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
    </div>
  )
}
