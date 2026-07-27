'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { AREA_NAMES, type AreaName, type Market } from '@/lib/types'
import { areaLabel } from '@/lib/utils/area-inference'
import { AlertCircle } from 'lucide-react'

interface Props {
  markets: Market[]
  loading: boolean
  error?: string | null
  region: AreaName | null
  onRegionChange: (region: AreaName) => void
  selectedMarkets: string[]
  onToggleMarket: (name: string) => void
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
    backgroundColor: active ? 'var(--crm-accent)' : 'var(--crm-surface-raised)',
    color: active ? '#FFF' : 'var(--crm-text-secondary)',
    transition: 'all .15s',
  }
}

/**
 * Two-step market picker: pick one region, then choose which of the org's
 * activated countries within it to include (all preselected by default).
 *
 * A single run always targets one region — mixing regions in one run isn't
 * supported, so SDR eligibility can be resolved directly from `region`
 * without inferring it from any of the chosen countries.
 */
export function RegionMarketSelect({
  markets, loading, error, region, onRegionChange, selectedMarkets, onToggleMarket,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('marketPicker')

  const inRegion = region ? markets.filter(m => m.region === region) : []
  const allOn = inRegion.length > 0 && inRegion.every(m => selectedMarkets.includes(m.name))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Step 1 — region (always all 4, single-select) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {AREA_NAMES.map(r => (
          <button key={r} onClick={() => onRegionChange(r)} style={chip(region === r)}>
            {areaLabel(r)}
          </button>
        ))}
      </div>

      {/* Step 2 — specific countries within the chosen region */}
      {region && (
        loading ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{t('loading')}</p>
        ) : error ? (
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
            <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', wordBreak: 'break-word' }}>{error}</span>
          </div>
        ) : inRegion.length === 0 ? (
          <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: 'var(--crm-surface-raised)', border: '1px dashed var(--crm-border)' }}>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 8px' }}>
              {t('noMarketsConfiguredForRegion', { region: areaLabel(region) })}
            </p>
            <Link href={`/${locale}/settings?tab=organization`}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-accent)', textDecoration: 'none' }}>
              {t('goToSettings')}
            </Link>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--crm-border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600 }}>
                {t('countriesSelected', { selected: selectedMarkets.length, total: inRegion.length })}
              </span>
              <button
                onClick={() => inRegion.forEach(m => {
                  const isSelected = selectedMarkets.includes(m.name)
                  if (allOn && isSelected) onToggleMarket(m.name)
                  if (!allOn && !isSelected) onToggleMarket(m.name)
                })}
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-secondary)', background: 'none', border: '1px solid var(--crm-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                {allOn ? t('clear') : t('selectAll')}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
              {inRegion.map(m => (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--crm-text-primary)' }}>
                  <input type="checkbox" checked={selectedMarkets.includes(m.name)} onChange={() => onToggleMarket(m.name)}
                    style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14, flexShrink: 0 }} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
