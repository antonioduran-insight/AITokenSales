'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Star, Building2 } from 'lucide-react'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { ICPScore } from '@/components/ui/ICPScore'
import type { Prospect } from '@/lib/types'

interface Props {
  prospect: Prospect
  onClick: (prospect: Prospect) => void
  isDragOverlay?: boolean
}

export function ProspectCard({ prospect, onClick, isDragOverlay = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: prospect.id,
  })

  const isBdContact = prospect.lead_type === 'bd_channel_contact'

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isDragOverlay ? 0.35 : 1,
    cursor: isDragOverlay ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={e => {
        e.stopPropagation()
        if (!isDragging) onClick(prospect)
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--crm-surface)',
          border: '1px solid var(--crm-border)',
          borderRadius: 8,
          padding: '14px',
          marginBottom: 8,
          transition: 'border-color 0.15s',
          boxShadow: isDragOverlay ? '0 8px 24px rgba(0,0,0,0.5)' : undefined,
        }}
        onMouseEnter={e => !isDragOverlay && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--crm-accent)')}
        onMouseLeave={e => !isDragOverlay && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--crm-border)')}
      >
        {/* Top row: flag + name */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          {prospect.flag_tomorrow && (
            <Star size={12} fill="#F59E0B" stroke="#F59E0B" style={{ flexShrink: 0, marginTop: 2 }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--crm-text-primary)', lineHeight: 1.3, flex: 1 }}>
            {prospect.name}
          </span>
        </div>

        {/* BD contacts: parent channel company, shown prominently */}
        {isBdContact && prospect.bd_channel && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5,
            padding: '3px 7px', borderRadius: 5,
            backgroundColor: '#6C63FF15', border: '1px solid #6C63FF30',
          }}>
            <Building2 size={11} color="var(--crm-accent)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--crm-accent)' }}>
              {prospect.bd_channel.company_name}
            </span>
          </div>
        )}

        {/* Company + title */}
        {(prospect.company || prospect.title) && (
          <div style={{ fontSize: 11, color: 'var(--crm-text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
            {prospect.title && <span>{prospect.title}</span>}
            {prospect.title && prospect.company && <span> · </span>}
            {prospect.company && <span>{prospect.company}</span>}
          </div>
        )}

        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          {isBdContact && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              backgroundColor: '#6C63FF20', color: 'var(--crm-accent)',
              borderRadius: 4, padding: '2px 5px', fontSize: 10, fontWeight: 700,
            }}>
              <Building2 size={9} /> BD
            </span>
          )}
          {prospect.area && <AreaBadge area={prospect.area} size="sm" />}
          {prospect.lead_temperature && <TemperatureBadge temperature={prospect.lead_temperature} />}
          {prospect.icp_score !== null && (
            <span
              style={{
                backgroundColor: 'var(--crm-surface-raised)',
                borderRadius: 4,
                padding: '2px 5px',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                color: 'var(--crm-text-muted)',
              }}
            >
              ICP <ICPScore score={prospect.icp_score} size="sm" />
            </span>
          )}
          {prospect.search_combo && (
            <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', backgroundColor: 'var(--crm-surface-raised)', padding: '2px 5px', borderRadius: 4 }}>
              {prospect.search_combo}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
