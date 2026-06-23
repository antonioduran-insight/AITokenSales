'use client'

import { useTranslations } from 'next-intl'
import type { LeadTemperature } from '@/lib/types'

const TEMP_STYLES: Record<LeadTemperature, { bg: string; color: string; dot: string }> = {
  Cold: { bg: '#1E2A3A', color: '#93C5FD', dot: '#60A5FA' },
  Warm: { bg: '#3A2A1A', color: '#FCD34D', dot: '#F59E0B' },
  Hot:  { bg: '#3A1A1A', color: '#FCA5A5', dot: '#EF4444' },
}

interface Props {
  temperature: LeadTemperature | null | undefined
}

export function TemperatureBadge({ temperature }: Props) {
  const t = useTranslations('temperature')
  if (!temperature) return null
  const style = TEMP_STYLES[temperature]

  return (
    <span
      style={{
        backgroundColor: style.bg,
        color: style.color,
        fontSize: '11px',
        padding: '2px 7px',
        borderRadius: '4px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: style.dot, display: 'inline-block' }} />
      {t(temperature)}
    </span>
  )
}
