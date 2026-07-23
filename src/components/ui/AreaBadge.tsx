'use client'

import { useLocale } from 'next-intl'
import type { Area } from '@/lib/types'

// Keyed by AreaName — the same vocabulary as markets.region.
const AREA_STYLES: Record<string, { bg: string; color: string }> = {
  asia:          { bg: '#1E3A5F', color: '#60A5FA' },
  latin_america: { bg: '#1A3A2A', color: '#4ADE80' },
  europe:        { bg: '#2A2A1A', color: '#FCD34D' },
  usa:           { bg: '#3A1A3A', color: '#C084FC' },
}

interface Props {
  area: Area | null | undefined
  size?: 'sm' | 'md'
}

export function AreaBadge({ area, size = 'sm' }: Props) {
  const locale = useLocale()
  if (!area) return null

  const style = AREA_STYLES[area.name] ?? { bg: 'var(--crm-surface-raised)', color: 'var(--crm-text-secondary)' }
  const label = area[`label_${locale}` as keyof Area] as string ?? area.label_en
  const inactive = !area.is_active

  return (
    <span
      style={{
        backgroundColor: style.bg,
        color: style.color,
        opacity: inactive ? 0.5 : 1,
        fontSize: size === 'sm' ? '11px' : '12px',
        padding: size === 'sm' ? '2px 6px' : '3px 8px',
        borderRadius: '4px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
