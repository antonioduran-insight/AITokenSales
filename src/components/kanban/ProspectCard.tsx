'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useTranslations } from 'next-intl'
import { Star, MessageSquareWarning, Link2 } from 'lucide-react'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { ICPScore } from '@/components/ui/ICPScore'
import { useComboLabels } from '@/lib/hooks/useComboLabels'
import type { Prospect } from '@/lib/types'

interface Props {
  prospect: Prospect
  onClick: (prospect: Prospect) => void
  isDragOverlay?: boolean
  /** Closed deal with zero conversations uploaded — surfaced so it never gets lost silently. */
  missingConversation?: boolean
  /** Just landed in this column — briefly highlighted so the move is visible (F13). */
  justMoved?: boolean
  /** Lets KanbanBoard capture this card's DOM node to scroll it into view on move. */
  cardRef?: (node: HTMLDivElement | null) => void
}

export function ProspectCard({ prospect, onClick, isDragOverlay = false, missingConversation = false, justMoved = false, cardRef }: Props) {
  const t = useTranslations('convertidos')
  const comboLabels = useComboLabels()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: prospect.id,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isDragOverlay ? 0.35 : 1,
    cursor: isDragOverlay ? 'grabbing' : 'grab',
    // Without this, touch browsers treat any drag start as a scroll gesture
    // on the column's horizontally-scrolling container, and dnd-kit's pointer
    // tracking never gets a clean signal — drag effectively doesn't work on
    // a touchscreen without it.
    touchAction: 'none' as const,
  }

  return (
    <div
      ref={node => { setNodeRef(node); cardRef?.(node) }}
      data-prospect-id={prospect.id}
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
          // A stronger green tint (distinct from the purple accent used for
          // hover/selection below) plus a higher-opacity ring — the previous
          // 19%-opacity ring was too subtle to notice, especially in a
          // long column where the card might not even be in view (that part
          // is handled by KanbanBoard's scrollIntoView on move).
          backgroundColor: justMoved ? '#22C55E1A' : 'var(--crm-surface)',
          border: `1px solid ${justMoved ? '#22C55E' : 'var(--crm-border)'}`,
          borderRadius: 8,
          padding: '14px',
          marginBottom: 8,
          transition: 'background-color 0.2s ease-out, border-color 0.2s ease-out, box-shadow 0.2s ease-out',
          boxShadow: isDragOverlay ? '0 8px 24px rgba(0,0,0,0.5)' : justMoved ? '0 0 0 3px #22C55E80' : '0 0 0 0px transparent',
        }}
        onMouseEnter={e => !isDragOverlay && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--crm-accent)')}
        onMouseLeave={e => !isDragOverlay && ((e.currentTarget as HTMLElement).style.borderColor = justMoved ? '#22C55E' : 'var(--crm-border)')}
      >
        {/* Top row: flag + name */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          {prospect.flag_tomorrow && (
            <Star size={12} fill="#F59E0B" stroke="#F59E0B" style={{ flexShrink: 0, marginTop: 2 }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--crm-text-primary)', lineHeight: 1.3, flex: 1 }}>
            {prospect.name}
          </span>
          {/* Bridge candidates are a different kind of contact from scraper
              leads — a partnership prospect, not a cold ICP lead — and the rep
              needs to know which one they are looking at BEFORE they write.
              Nothing else on the card distinguishes them. */}
          {prospect.source === 'bridge' && (
            <span
              title={t('fromBridge')}
              style={{
                display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginTop: 1,
                backgroundColor: '#6C63FF20', color: '#8B84FF',
                border: '1px solid #6C63FF40', borderRadius: 4,
                padding: '1px 5px', fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
              }}
            >
              <Link2 size={9} />
              {t('bridgeBadge')}
            </span>
          )}
          {missingConversation && (
            <span title={t('missingConversation')} style={{ display: 'flex', flexShrink: 0, marginTop: 1 }}>
              <MessageSquareWarning size={13} color="#EF4444" />
            </span>
          )}
        </div>

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
              {comboLabels[prospect.search_combo] ?? prospect.search_combo}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
