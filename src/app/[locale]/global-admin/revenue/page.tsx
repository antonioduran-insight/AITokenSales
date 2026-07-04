'use client'

import { useEffect, useState } from 'react'
import type { Organization, Vendor } from '@/lib/types'
import { PLAN_PRICES } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'

function calcMRR(org: Organization): number {
  if (!org.is_active) return 0
  if (org.plan === 'enterprise') return org.custom_price ?? 0
  if (org.plan === 'ultra') return 0
  return PLAN_PRICES[org.plan] ?? 0
}

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',
  premium: '#8B5CF6',
  enterprise: '#F59E0B',
  ultra: '#EF4444',
}

export default function RevenuePage() {
  const { colors, t } = useGlobalAdminTheme()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [vendorCommissions, setVendorCommissions] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/global-admin/organizations').then(r => r.json()),
      fetch('/api/global-admin/vendors').then(r => r.json()),
    ]).then(([orgsData, vendorsData]) => {
      setOrgs(Array.isArray(orgsData) ? orgsData : [])
      if (Array.isArray(vendorsData)) {
        const map: Record<string, number> = {}
        vendorsData.forEach((v: Vendor) => { if (v.name) map[v.name] = v.commission_pct ?? 0 })
        setVendorCommissions(map)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const activeOrgs = orgs.filter(o => o.is_active)
  const totalMRR = orgs.reduce((sum, o) => sum + calcMRR(o), 0)
  const activeClients = activeOrgs.length
  const ultraClients = orgs.filter(o => o.plan === 'ultra').length
  const payingClients = activeOrgs.filter(o => o.plan !== 'ultra').length

  const mrrTable = [...orgs].sort((a, b) => calcMRR(b) - calcMRR(a))

  const plans = ['basic', 'premium', 'enterprise'] as const
  const planStats = plans.map(p => {
    const planOrgs = orgs.filter(o => o.plan === p)
    const mrr = planOrgs.reduce((sum, o) => sum + calcMRR(o), 0)
    return { plan: p, count: planOrgs.length, mrr }
  })

  // Revenue by vendor using real commission_pct from vendors table
  const vendorMap = new Map<string, { count: number; mrr: number; commissionPct: number }>()
  orgs.forEach(o => {
    const v = o.vendor ?? 'direct'
    const commissionPct = v === 'direct' ? 0 : (vendorCommissions[v] ?? 0)
    const existing = vendorMap.get(v) ?? { count: 0, mrr: 0, commissionPct }
    vendorMap.set(v, { count: existing.count + 1, mrr: existing.mrr + calcMRR(o), commissionPct })
  })
  const vendorStats = Array.from(vendorMap.entries()).map(([name, stats]) => ({
    name,
    ...stats,
    commission: name === 'direct' ? 0 : Math.round(stats.mrr * (stats.commissionPct / 100)),
  })).sort((a, b) => b.mrr - a.mrr)

  const cardStyle: React.CSSProperties = {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: '20px 24px',
    flex: 1,
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
  }

  const tdStyle: React.CSSProperties = {
    padding: '11px 14px',
    fontSize: 13,
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`,
  }

  if (loading) {
    return <div style={{ color: colors.textSecondary, padding: 60, textAlign: 'center' }}>{t('loading')}</div>
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, marginBottom: 24 }}>{t('revenue')}</h1>

      {/* Stats cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>{t('mrrTotal')}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colors.success }}>${totalMRR.toLocaleString()}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>{t('activeClients')}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colors.textPrimary }}>{activeClients}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>{t('ultraClients')}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colors.textMuted }}>{ultraClients}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>{t('payingClients')}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#A78BFA' }}>{payingClients}</div>
        </div>
      </div>

      {payingClients === 0 ? (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 60, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>
          No paying clients yet.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            {/* Revenue by plan */}
            <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 16 }}>{t('revenueByPlan')}</div>
              {planStats.map(({ plan, count, mrr }) => (
                <div key={plan} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: PLAN_COLORS[plan], fontWeight: 600, textTransform: 'capitalize' }}>{plan}</span>
                    <span style={{ color: colors.textSecondary }}>{count} orgs · <span style={{ color: colors.success, fontWeight: 600 }}>${mrr.toLocaleString()}</span></span>
                  </div>
                  <div style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: totalMRR > 0 ? `${Math.round((mrr / totalMRR) * 100)}%` : '0%',
                      backgroundColor: PLAN_COLORS[plan],
                      borderRadius: 3,
                    }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Revenue by vendor */}
            <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 16 }}>{t('revenueByVendor')}</div>
              {vendorStats.length === 0
                ? <div style={{ color: colors.textMuted, fontSize: 13 }}>No data</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {[t('vendor'), 'Orgs', t('mrr'), t('commissionPct'), t('commission')].map(col => (
                          <th key={col} style={{ ...thStyle, padding: '8px 10px', fontSize: 10 }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vendorStats.map(({ name, count, mrr, commission, commissionPct }) => (
                        <tr key={name}>
                          <td style={{ ...tdStyle, fontWeight: 600, padding: '10px' }}>{name}</td>
                          <td style={{ ...tdStyle, color: colors.textSecondary, padding: '10px' }}>{count}</td>
                          <td style={{ ...tdStyle, color: colors.success, fontWeight: 600, padding: '10px' }}>${mrr.toLocaleString()}</td>
                          <td style={{ ...tdStyle, color: colors.textSecondary, padding: '10px' }}>{name === 'direct' ? '—' : `${commissionPct}%`}</td>
                          <td style={{ ...tdStyle, color: commission > 0 ? colors.warning : colors.textMuted, padding: '10px' }}>
                            {commission > 0 ? `$${commission.toLocaleString()}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </div>
          </div>

          {/* MRR Table */}
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
              {t('mrrByOrg')}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[t('organization'), t('plan'), t('mrr'), t('vendor'), t('created')].map(col => (
                    <th key={col} style={thStyle}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mrrTable.map(org => {
                  const mrr = calcMRR(org)
                  return (
                    <tr key={org.id}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{org.name}</td>
                      <td style={tdStyle}>
                        <span style={{
                          backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22',
                          color: PLAN_COLORS[org.plan] ?? colors.accent,
                          borderRadius: 4,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}>
                          {org.plan}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: mrr > 0 ? colors.success : colors.textMuted, fontWeight: 600 }}>
                        {mrr > 0 ? `$${mrr.toLocaleString()}` : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary }}>{org.vendor ?? '—'}</td>
                      <td style={{ ...tdStyle, color: colors.textSecondary }}>{new Date(org.created_at).toLocaleDateString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {mrrTable.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>No organizations</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
