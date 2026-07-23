'use client'

import Link from 'next/link'
import { useLocale } from 'next-intl'
import { AREA_NAMES, type Market } from '@/lib/types'
import { areaLabel } from '@/lib/utils/area-inference'
import { AlertCircle } from 'lucide-react'

interface Props {
  markets: Market[]
  loading: boolean
  error?: string | null
  value: string | null
  onChange: (marketName: string) => void
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : 'var(--crm-text-secondary)',
    transition: 'all .15s',
  }
}

// Regions in their canonical order, with anything unexpected last.
function orderRegions(markets: Market[]): string[] {
  const present = [...new Set(markets.map(m => m.region))]
  const known = (AREA_NAMES as readonly string[]).filter(r => present.includes(r))
  const rest = present.filter(r => !known.includes(r)).sort()
  return [...known, ...rest]
}

/**
 * Single-select market picker fed by the organization's activated markets.
 * Shows a pointer to Settings when the org hasn't configured any yet.
 */
export function MarketSelect({ markets, loading, error, value, onChange }: Props) {
  const locale = useLocale()

  if (loading) {
    return <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading markets…</p>
  }

  if (error) {
    return (
      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
        <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', wordBreak: 'break-word' }}>{error}</span>
      </div>
    )
  }

  if (markets.length === 0) {
    return (
      <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--crm-surface-raised)', border: '1px dashed var(--crm-border)' }}>
        <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 8px' }}>
          No markets configured.
        </p>
        <Link href={`/${locale}/settings?tab=organization`}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-accent)', textDecoration: 'none' }}>
          Go to Settings to select your markets →
        </Link>
      </div>
    )
  }

  const regions = orderRegions(markets)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {regions.map(region => (
        <div key={region}>
          <div style={{ fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            {areaLabel(region)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {markets.filter(m => m.region === region).map(m => (
              <button key={m.id} onClick={() => onChange(m.name)} style={chip(value === m.name)}>
                {m.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
