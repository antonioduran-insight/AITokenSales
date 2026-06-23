'use client'

import { useDroppable } from '@dnd-kit/core'
import { ProspectCard } from './ProspectCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Prospect, OutreachStatus } from '@/lib/types'

interface Props {
  status: OutreachStatus
  prospects: Prospect[]
  onCardClick: (prospect: Prospect) => void
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

export function KanbanColumn({ status, prospects, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const isTerminal = TERMINAL.includes(status)
  const accent = COLUMN_ACCENT[status]

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
        <StatusBadge status={status} size="md" />
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
          {prospects.length}
        </span>
      </div>

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
        {prospects.map(p => (
          <ProspectCard key={p.id} prospect={p} onClick={onCardClick} />
        ))}
        {prospects.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: '#2A2A3A',
              fontSize: 12,
              padding: '24px 8px',
              border: '1px dashed #2A2A3A',
              borderRadius: 8,
              marginTop: 4,
            }}
          >
            —
          </div>
        )}
      </div>
    </div>
  )
}
