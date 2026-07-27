'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDroppable } from '@dnd-kit/core'
import { Search, X } from 'lucide-react'
import { ProspectCard } from './ProspectCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Prospect, OutreachStatus } from '@/lib/types'

interface Props {
  status: OutreachStatus
  label?: string
  color?: string
  prospects: Prospect[]
  onCardClick: (prospect: Prospect) => void
  /** Prospect id -> conversation count. Only passed for the Closed column. */
  chatCounts?: Record<string, number>
  /** Prospect id that just landed in a new column — briefly highlighted. */
  recentlyMovedId?: string | null
  /** Captures each card's DOM node so KanbanBoard can scroll a moved card into view. */
  setCardRef?: (id: string, node: HTMLDivElement | null) => void
}

const COLUMN_ACCENT: Record<OutreachStatus, string> = {
  new:             '#52526A',
  connection_sent: '#3B82F6',
  connected:       '#6C63FF',
  replied:         '#22C55E',
  demo_scheduled:  '#F59E0B',
  closed:          '#10B981',
  nurture:         '#A78BFA',
}

const TERMINAL: OutreachStatus[] = ['closed', 'nurture']

export function KanbanColumn({ status, label, color, prospects, onCardClick, chatCounts, recentlyMovedId, setCardRef }: Props) {
  const t = useTranslations('common')
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const isTerminal = TERMINAL.includes(status)
  const accent = color ?? COLUMN_ACCENT[status]
  // QA-F15: filters cards within this column only — doesn't touch other
  // columns' counts/contents or refetch anything, purely a client-side view filter.
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visibleProspects = q
    ? prospects.filter(p => p.name.toLowerCase().includes(q) || (p.company ?? '').toLowerCase().includes(q))
    : prospects

  return (
    <div
      style={{
        width: 230,
        minWidth: 230,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
      }}
    >
      {/* Column header */}
      <div
        style={{
          padding: '8px 12px 10px',
          borderBottom: `2px solid ${accent}`,
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {label
          ? <span style={{ fontSize: 12, fontWeight: 600, color: accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
          : <StatusBadge status={status} size="md" />
        }
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: accent,
            backgroundColor: `${accent}20`,
            borderRadius: '50%',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {q ? visibleProspects.length : prospects.length}
        </span>
      </div>

      {/* Per-column search — filters this column's cards only (QA-F15) */}
      {prospects.length > 0 && (
        <div style={{ position: 'relative', margin: '0 4px 6px' }}>
          <Search size={12} color="var(--crm-text-muted)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search')}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '5px 24px',
              fontSize: 11,
              borderRadius: 6,
              border: '1px solid var(--crm-border)',
              backgroundColor: 'var(--crm-surface)',
              color: 'var(--crm-text-primary)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--crm-text-muted)' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 4px 8px',
          borderRadius: 8,
          backgroundColor: isOver ? `${accent}10` : isTerminal ? '#0D0D13' : 'transparent',
          transition: 'background-color 0.15s',
          minHeight: 80,
        }}
      >
        {visibleProspects.map(p => (
          <ProspectCard
            key={p.id}
            prospect={p}
            onClick={onCardClick}
            missingConversation={!!chatCounts && (chatCounts[p.id] ?? 0) === 0}
            justMoved={p.id === recentlyMovedId}
            cardRef={setCardRef ? node => setCardRef(p.id, node) : undefined}
          />
        ))}
        {prospects.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--crm-border)',
              fontSize: 12,
              padding: '24px 8px',
              border: '1px dashed var(--crm-border)',
              borderRadius: 8,
              marginTop: 4,
            }}
          >
            —
          </div>
        )}
        {prospects.length > 0 && visibleProspects.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--crm-text-muted)',
              fontSize: 12,
              padding: '24px 8px',
            }}
          >
            {t('noMatches')}
          </div>
        )}
      </div>
    </div>
  )
}
