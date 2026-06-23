'use client'

import { useTranslations } from 'next-intl'
import type { OutreachStatus } from '@/lib/types'

const STATUS_STYLES: Record<OutreachStatus, { bg: string; color: string }> = {
  new:              { bg: '#1C1C27', color: '#8B8BA0' },
  connection_sent:  { bg: '#1E3A5F', color: '#60A5FA' },
  connected:        { bg: '#2A1F5F', color: '#A78BFA' },
  replied:          { bg: '#1A3A2A', color: '#4ADE80' },
  demo_scheduled:   { bg: '#3A2A1A', color: '#FCD34D' },
  closed:           { bg: '#1A3A2A', color: '#22C55E' },
  nurture:          { bg: '#2A1A3A', color: '#C084FC' },
}

interface Props {
  status: OutreachStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const t = useTranslations('outreachStatus')
  const style = STATUS_STYLES[status]

  return (
    <span
      style={{
        backgroundColor: style.bg,
        color: style.color,
        fontSize: size === 'sm' ? '11px' : '12px',
        padding: size === 'sm' ? '2px 7px' : '3px 9px',
        borderRadius: '4px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {t(status)}
    </span>
  )
}
