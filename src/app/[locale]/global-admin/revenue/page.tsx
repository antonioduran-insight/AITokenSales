'use client'

import { useEffect, useState } from 'react'
import type { Organization, Vendor } from '@/lib/types'
import { PLAN_PRICES } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

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

const SETUP_FEE = 1000

// Q definitions for 2026 — using 0-indexed JS months
const QUARTERS = {
  Q1: { months: [6, 7, 8], label: 'July · August · September', payment: 'September 15–20', year: 2026 },
  Q2: { months: [9, 10, 11], label: 'October · November · December', payment: 'December 15–20', year: 2026 },
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatUSD(n: number) {
  return `$${n.toLocaleString()}`
}

export default function RevenuePage() {
  const { colors, t } = useGlobalAdminTheme()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [vendorList, setVendorList] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQ, setSelectedQ] = useState<'Q1' | 'Q2'>('Q1')

  useEffect(() => {
    Promise.all([
      fetch('/api/global-admin/organizations').then(r => r.json()),
      fetch('/api/global-admin/vendors').then(r => r.json()),
    ]).then(([orgsData, vendorsData]) => {
      setOrgs(Array.isArray(orgsData) ? orgsData : [])
      setVendorList(Array.isArray(vendorsData) ? vendorsData : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const vendorCommissions: Record<string, number> = {}
  vendorList.forEach((v: Vendor) => { if (v.name) vendorCommissions[v.name] = v.commission_pct ?? 0 })

  const q = QUARTERS[selectedQ]
  const qStart = new Date(q.year, q.months[0], 1)
  const qEnd = new Date(q.year, q.months[2] + 1, 0, 23, 59, 59)

  const activeOrgs = orgs.filter(o => o.is_active)
  const totalMRR = activeOrgs.reduce((sum, o) => sum + calcMRR(o), 0)

  // Orgs created within the selected Q → setup fee
  const setupOrgsList = orgs.filter(o => {
    const d = new Date(o.created_at)
    return d >= qStart && d <= qEnd
  })
  const totalSetupFees = setupOrgsList.length * SETUP_FEE

  // Projected Q revenue = MRR × 3 months + setup fees
  const qMRR = totalMRR * 3
  const qTotal = qMRR + totalSetupFees

  const activeClients = activeOrgs.filter(o => o.plan !== 'ultra').length

  // Revenue by vendor
  type VendorStat = { count: number; mrr: number; commissionPct: number; setupFees: number }
  const vendorMap = new Map<string, VendorStat>()
  activeOrgs.forEach(o => {
    const v = o.vendor ?? 'Direct'
    const commissionPct = v === 'Direct' ? 0 : (vendorCommissions[v] ?? 0)
    const existing = vendorMap.get(v) ?? { count: 0, mrr: 0, commissionPct, setupFees: 0 }
    vendorMap.set(v, { count: existing.count + 1, mrr: existing.mrr + calcMRR(o), commissionPct, setupFees: existing.setupFees })
  })
  // Add setup fees to vendor map
  setupOrgsList.forEach(o => {
    const v = o.vendor ?? 'Direct'
    const existing = vendorMap.get(v)
    if (existing) vendorMap.set(v, { ...existing, setupFees: existing.setupFees + SETUP_FEE })
  })
  const vendorStats = Array.from(vendorMap.entries()).map(([name, stats]) => ({
    name,
    ...stats,
    qRevenue: stats.mrr * 3 + stats.setupFees,
    commission: name === 'Direct' ? 0 : Math.round((stats.mrr * 3 + stats.setupFees) * (stats.commissionPct / 100)),
  })).sort((a, b) => b.mrr - a.mrr)

  // Profit sharing
  const INFRA_COST = 170
  const directRevenue = vendorStats.find(v => v.name === 'Direct')?.qRevenue ?? qTotal
  const vendorCuts = vendorStats.filter(v => v.name !== 'Direct').map(v => ({
    name: v.name,
    cut: v.commission,
    qRevenue: v.qRevenue,
    commissionPct: v.commissionPct,
  }))
  const totalVendorCuts = vendorCuts.reduce((sum, v) => sum + v.cut, 0)
  const netToPartners = qTotal - totalVendorCuts - INFRA_COST
  const frankShare = Math.round(netToPartners / 2)
  const nicolasShare = Math.round(netToPartners / 2)

  // Cumulative MRR chart — monthly accumulation for Q months
  const chartData = q.months.map((monthIdx, i) => {
    // Orgs active by end of this month
    const monthEnd = new Date(q.year, monthIdx + 1, 0, 23, 59, 59)
    const activeThen = orgs.filter(o => {
      if (!o.is_active) return false
      const created = new Date(o.created_at)
      return created <= monthEnd
    })
    const mrr = activeThen.reduce((sum, o) => sum + calcMRR(o), 0)
    const setupThisMonth = orgs.filter(o => {
      const d = new Date(o.created_at)
      return d.getMonth() === monthIdx && d.getFullYear() === q.year
    }).length * SETUP_FEE
    return { month: MONTH_NAMES[monthIdx], mrr, setup: setupThisMonth, monthIndex: i }
  })

  const cardStyle: React.CSSProperties = {
    backgroundColor: colors.surface, border: `1px solid ${colors.border}`,
    borderRadius: 10, padding: '20px 24px', flex: 1,
  }
  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
  }
  const tdStyle: React.CSSProperties = {
    padding: '11px 14px', fontSize: 13, color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`,
  }

  if (loading) {
    return <div style={{ color: colors.textSecondary, padding: 60, textAlign: 'center' }}>{t('loading')}</div>
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, marginBottom: 24 }}>{t('revenue')}</h1>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>MRR Total</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.success }}>{formatUSD(totalMRR)}<span style={{ fontSize: 14, fontWeight: 400, color: colors.textMuted }}>/mo</span></div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Q projected: <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{formatUSD(qMRR)}</span></div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Setup Fees {selectedQ}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#F59E0B' }}>{formatUSD(totalSetupFees)}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{setupOrgsList.length} new orgs × {formatUSD(SETUP_FEE)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Active Clients</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{activeClients}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>paying plans</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Churn</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#22C55E' }}>0</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>this quarter</div>
        </div>
      </div>

      {/* Q selector + breakdown */}
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary }}>Quarter Breakdown</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{q.label} · Payment: {q.payment}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['Q1', 'Q2'] as const).map(qKey => (
              <button
                key={qKey}
                onClick={() => setSelectedQ(qKey)}
                style={{
                  padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                  backgroundColor: selectedQ === qKey ? colors.accent : colors.surfaceRaised,
                  color: selectedQ === qKey ? '#fff' : colors.textSecondary,
                }}
              >
                {qKey}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Q Revenue summary */}
          <div style={{ backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
              {selectedQ} Revenue Summary
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'MRR (× 3 months)', value: qMRR, color: colors.success },
                { label: 'Setup Fees', value: totalSetupFees, color: '#F59E0B' },
                { label: 'Gross Revenue', value: qTotal, color: colors.textPrimary, bold: true },
                { label: 'Infrastructure', value: -INFRA_COST, color: '#EF4444' },
                { label: 'Vendor commissions', value: -totalVendorCuts, color: '#EF4444' },
                { label: 'Net to distribute', value: netToPartners, color: colors.accent, bold: true },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 600, color: row.color }}>
                    {row.value < 0 ? `-${formatUSD(Math.abs(row.value))}` : formatUSD(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Profit sharing */}
          <div style={{ backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
              Profit Sharing — {selectedQ} (pay {q.payment})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Direct partners */}
              <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 4 }}>DIRECT SALES</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>Frank Kao</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{formatUSD(frankShare)} <span style={{ color: colors.textMuted, fontSize: 11 }}>(50%)</span></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>Nicolás Nicoli</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{formatUSD(nicolasShare)} <span style={{ color: colors.textMuted, fontSize: 11 }}>(50%)</span></span>
              </div>

              {/* Vendor cuts */}
              {vendorCuts.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>VENDOR COMMISSIONS</div>
                  {vendorCuts.map(v => (
                    <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: colors.textSecondary }}>{v.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{formatUSD(v.cut)} <span style={{ color: colors.textMuted, fontSize: 11 }}>({v.commissionPct}%)</span></span>
                    </div>
                  ))}
                </>
              )}

              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>Net to distribute</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>{formatUSD(netToPartners)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MRR Chart */}
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 16 }}>Monthly MRR — {selectedQ}</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fill: colors.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
            <Tooltip
              contentStyle={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [typeof v === 'number' ? formatUSD(v) : String(v ?? ''), 'MRR']}
              cursor={{ fill: `${colors.accent}15` }}
            />
            <Bar dataKey="mrr" fill={colors.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* MRR by org table */}
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>MRR by Organization</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Organization', 'Plan', 'MRR', 'Q Revenue', 'Vendor'].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...activeOrgs].sort((a, b) => calcMRR(b) - calcMRR(a)).map(org => {
                const mrr = calcMRR(org)
                const qRev = mrr * 3
                return (
                  <tr key={org.id}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{org.name}</td>
                    <td style={tdStyle}>
                      <span style={{ backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22', color: PLAN_COLORS[org.plan] ?? colors.accent, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                        {org.plan}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: mrr > 0 ? colors.success : colors.textMuted, fontWeight: 600 }}>
                      {mrr > 0 ? formatUSD(mrr) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>
                      {qRev > 0 ? formatUSD(qRev) : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{org.vendor ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {activeOrgs.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>No active organizations</div>
          )}
        </div>

        {/* Setup Fees + Vendor breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Setup Fees */}
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>Setup Fees — {selectedQ}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B' }}>{formatUSD(totalSetupFees)}</span>
            </div>
            {setupOrgsList.length === 0 ? (
              <div style={{ padding: '20px 24px', color: colors.textMuted, fontSize: 13 }}>No new orgs this quarter</div>
            ) : (
              setupOrgsList.map(org => (
                <div key={org.id} style={{ padding: '10px 20px', borderBottom: `1px solid ${colors.surfaceRaised}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{org.name}</span>
                    <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 8, textTransform: 'uppercase' }}>{org.plan}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{formatUSD(SETUP_FEE)}</div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{new Date(org.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Revenue by Vendor */}
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>Revenue by Vendor</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Vendor', 'Orgs', 'MRR', 'Q Rev', 'Commission', 'Their Cut'].map(col => (
                    <th key={col} style={{ ...thStyle, padding: '8px 12px', fontSize: 10 }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendorStats.map(({ name, count, mrr, qRevenue, commissionPct, commission }) => (
                  <tr key={name}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, padding: '10px 12px' }}>{name}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '10px 12px' }}>{count}</td>
                    <td style={{ ...tdStyle, color: colors.success, fontWeight: 600, padding: '10px 12px' }}>{formatUSD(mrr)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '10px 12px' }}>{formatUSD(qRevenue)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '10px 12px' }}>{name === 'Direct' ? '—' : `${commissionPct}%`}</td>
                    <td style={{ ...tdStyle, color: commission > 0 ? '#F59E0B' : colors.textMuted, padding: '10px 12px' }}>
                      {commission > 0 ? formatUSD(commission) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
