'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import type { Organization, Vendor } from '@/lib/types'
import { PLAN_PRICES, isBillablePlan } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

function calcMRR(org: Organization): number {
  if (!org.is_active) return 0
  if (org.plan === 'enterprise') return org.custom_price ?? 0
  // Internal (ultra) and unpaid trials (demo) contribute nothing.
  if (!isBillablePlan(org.plan)) return 0
  return PLAN_PRICES[org.plan] ?? 0
}

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6', premium: '#8B5CF6', enterprise: '#F59E0B', ultra: '#EF4444', demo: '#14B8A6',
}

const SETUP_FEE = 1000

const QUARTERS = {
  Q1: { months: [6, 7, 8], label: 'July · August · September', payment: 'September 15–20', year: 2026 },
  Q2: { months: [9, 10, 11], label: 'October · November · December', payment: 'December 15–20', year: 2026 },
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatUSD(n: number) { return `$${n.toLocaleString()}` }

interface MonthlyCosts {
  vercel: number
  supabase: number
  railway: number
  apify: number
  claude: number
}

const DEFAULT_COSTS: MonthlyCosts = { vercel: 0, supabase: 0, railway: 0, apify: 0, claude: 0 }

function loadCosts(): MonthlyCosts {
  if (typeof window === 'undefined') return DEFAULT_COSTS
  try {
    const raw = localStorage.getItem('ga_monthly_costs')
    return raw ? { ...DEFAULT_COSTS, ...JSON.parse(raw) } : DEFAULT_COSTS
  } catch { return DEFAULT_COSTS }
}

function saveCosts(costs: MonthlyCosts) {
  localStorage.setItem('ga_monthly_costs', JSON.stringify(costs))
}

export default function RevenuePage() {
  const { colors, t } = useGlobalAdminTheme()
  const locale = useLocale()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [vendorList, setVendorList] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedQ, setSelectedQ] = useState<'Q1' | 'Q2'>('Q1')
  const [costs, setCosts] = useState<MonthlyCosts>(DEFAULT_COSTS)

  useEffect(() => {
    setCosts(loadCosts())
    Promise.all([
      fetch('/api/global-admin/organizations').then(r => r.json()),
      fetch('/api/global-admin/vendors').then(r => r.json()),
    ]).then(([orgsData, vendorsData]) => {
      setOrgs(Array.isArray(orgsData) ? orgsData : [])
      setVendorList(Array.isArray(vendorsData) ? vendorsData : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function updateCost(key: keyof MonthlyCosts, value: number) {
    const next = { ...costs, [key]: value }
    setCosts(next)
    saveCosts(next)
  }

  const vendorCommissions: Record<string, number> = {}
  vendorList.forEach((v: Vendor) => { if (v.name) vendorCommissions[v.name] = v.commission_pct ?? 0 })

  const q = QUARTERS[selectedQ]
  const qStart = new Date(q.year, q.months[0], 1)
  const qEnd = new Date(q.year, q.months[2] + 1, 0, 23, 59, 59)

  const activeOrgs = orgs.filter(o => o.is_active && o.plan !== 'ultra')
  const totalMRR = activeOrgs.reduce((sum, o) => sum + calcMRR(o), 0)

  // Setup fees: only non-ultra orgs created in this Q
  const setupOrgsList = orgs.filter(o => {
    const d = new Date(o.created_at)
    return d >= qStart && d <= qEnd && o.plan !== 'ultra'
  })
  const totalSetupFees = setupOrgsList.length * SETUP_FEE

  const qMRR = totalMRR * 3
  const qTotal = qMRR + totalSetupFees
  const activeClients = activeOrgs.length

  // Monthly + Q infrastructure costs
  const monthlyInfra = costs.vercel + costs.supabase + costs.railway
  const monthlyAPI = costs.apify + costs.claude
  const monthlyTotal = monthlyInfra + monthlyAPI
  const qCosts = monthlyTotal * 3

  // Revenue by vendor
  type VendorStat = { count: number; mrr: number; commissionPct: number; setupFees: number }
  const vendorMap = new Map<string, VendorStat>()
  activeOrgs.forEach(o => {
    const v = o.vendor ?? 'Direct'
    const commissionPct = v === 'Direct' ? 0 : (vendorCommissions[v] ?? 0)
    const existing = vendorMap.get(v) ?? { count: 0, mrr: 0, commissionPct, setupFees: 0 }
    vendorMap.set(v, { count: existing.count + 1, mrr: existing.mrr + calcMRR(o), commissionPct, setupFees: existing.setupFees })
  })
  setupOrgsList.forEach(o => {
    const v = o.vendor ?? 'Direct'
    const existing = vendorMap.get(v)
    if (existing) vendorMap.set(v, { ...existing, setupFees: existing.setupFees + SETUP_FEE })
  })
  const vendorStats = Array.from(vendorMap.entries()).map(([name, stats]) => ({
    name, ...stats,
    qRevenue: stats.mrr * 3 + stats.setupFees,
    commission: name === 'Direct' ? 0 : Math.round((stats.mrr * 3 + stats.setupFees) * (stats.commissionPct / 100)),
  })).sort((a, b) => b.mrr - a.mrr)

  // Profit sharing
  const totalVendorCuts = vendorStats.filter(v => v.name !== 'Direct').reduce((sum, v) => sum + v.commission, 0)
  const vendorCuts = vendorStats.filter(v => v.name !== 'Direct' && v.commission > 0).map(v => ({
    name: v.name, cut: v.commission, commissionPct: v.commissionPct,
  }))
  const netToPartners = qTotal - totalVendorCuts - qCosts
  const frankShare = Math.round(netToPartners / 2)
  const nicolasShare = Math.round(netToPartners / 2)

  // Chart data
  const chartData = q.months.map(monthIdx => {
    const monthEnd = new Date(q.year, monthIdx + 1, 0, 23, 59, 59)
    const activeThen = orgs.filter(o => {
      if (!o.is_active || !isBillablePlan(o.plan)) return false
      return new Date(o.created_at) <= monthEnd
    })
    return { month: MONTH_NAMES[monthIdx], mrr: activeThen.reduce((sum, o) => sum + calcMRR(o), 0) }
  })

  const cardStyle: React.CSSProperties = {
    backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '18px 22px', flex: 1,
  }
  const thStyle: React.CSSProperties = {
    padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
  }
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13, color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`,
  }
  const costInputStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    color: colors.textPrimary, borderRadius: 5, padding: '5px 8px', fontSize: 13,
    width: 80, outline: 'none', textAlign: 'right',
  }

  if (loading) return <div style={{ color: colors.textSecondary, padding: 60, textAlign: 'center' }}>{t('loading')}</div>

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <span style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, backgroundColor: colors.accent, color: '#fff' }}>Overview</span>
        <Link href={`/${locale}/global-admin/revenue/reports`} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, backgroundColor: colors.surfaceRaised, color: colors.textSecondary, textDecoration: 'none' }}>Reports</Link>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, marginBottom: 24 }}>{t('revenue')}</h1>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>MRR Total</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.success }}>{formatUSD(totalMRR)}<span style={{ fontSize: 13, fontWeight: 400, color: colors.textMuted }}>/mo</span></div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Q projected: <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{formatUSD(qMRR)}</span></div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Setup Fees {selectedQ}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#F59E0B' }}>{formatUSD(totalSetupFees)}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{setupOrgsList.length} new orgs × {formatUSD(SETUP_FEE)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Active Clients</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{activeClients}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>paying plans</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>Q Revenue</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.accent }}>{formatUSD(qTotal)}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>gross {selectedQ}</div>
        </div>
      </div>

      {/* Q selector + breakdown */}
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary }}>Quarter Breakdown</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{q.label} · Payment: {q.payment}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['Q1', 'Q2'] as const).map(qKey => (
              <button key={qKey} onClick={() => setSelectedQ(qKey)} style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                backgroundColor: selectedQ === qKey ? colors.accent : colors.surfaceRaised,
                color: selectedQ === qKey ? '#fff' : colors.textSecondary,
              }}>
                {qKey}
              </button>
            ))}
          </div>
        </div>

        <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Q Revenue */}
          <div style={{ backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{selectedQ} Revenue</div>
            {[
              { label: 'MRR (× 3 months)', value: qMRR, color: colors.success },
              { label: 'Setup Fees', value: totalSetupFees, color: '#F59E0B' },
              { label: 'Gross Revenue', value: qTotal, color: colors.textPrimary, bold: true },
              { label: `Costs (${formatUSD(monthlyTotal)}/mo × 3)`, value: -qCosts, color: '#EF4444' },
              { label: 'Vendor commissions', value: -totalVendorCuts, color: '#EF4444' },
              { label: 'Net to distribute', value: netToPartners, color: colors.accent, bold: true },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 600, color: row.color }}>
                  {row.value < 0 ? `-${formatUSD(Math.abs(row.value))}` : formatUSD(row.value)}
                </span>
              </div>
            ))}
          </div>

          {/* Profit sharing */}
          <div style={{ backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Profit Sharing — {selectedQ} (pay {q.payment})
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 6 }}>PARTNERS</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>Frank Kao</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{formatUSD(frankShare)} <span style={{ color: colors.textMuted, fontSize: 11 }}>(50%)</span></span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>Nicolás Nicoli</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{formatUSD(nicolasShare)} <span style={{ color: colors.textMuted, fontSize: 11 }}>(50%)</span></span>
            </div>
            {vendorCuts.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 6, marginTop: 4 }}>VENDOR COMMISSIONS</div>
                {vendorCuts.map(v => (
                  <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: colors.textSecondary }}>{v.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{formatUSD(v.cut)} <span style={{ color: colors.textMuted, fontSize: 11 }}>({v.commissionPct}%)</span></span>
                  </div>
                ))}
              </>
            )}
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: colors.textMuted }}>Net to distribute</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>{formatUSD(netToPartners)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Costs section */}
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary }}>{t('monthlyCosts')}</div>
          <span style={{ fontSize: 12, color: colors.textMuted }}>{t('total')}: <strong style={{ color: colors.textSecondary }}>{formatUSD(monthlyTotal)}/mo</strong> · {selectedQ}: <strong style={{ color: colors.danger }}>{formatUSD(qCosts)}</strong></span>
        </div>
        <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Infrastructure */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{t('infrastructure')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { key: 'vercel', label: 'Vercel' },
                { key: 'supabase', label: 'Supabase' },
                { key: 'railway', label: 'Railway' },
              ] as { key: keyof MonthlyCosts; label: string }[]).map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>$</span>
                    <input
                      type="number"
                      min={0}
                      value={costs[key] || ''}
                      onChange={e => updateCost(key, Number(e.target.value) || 0)}
                      placeholder="0"
                      style={costInputStyle}
                    />
                    <span style={{ fontSize: 12, color: colors.textMuted }}>/mo</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${colors.border}`, paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 600 }}>{t('subtotal')}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>{formatUSD(monthlyInfra)}/mo</span>
              </div>
            </div>
          </div>

          {/* API costs */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{t('apiCosts')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { key: 'apify', label: 'Apify' },
                { key: 'claude', label: 'Claude (Anthropic)' },
              ] as { key: keyof MonthlyCosts; label: string }[]).map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>$</span>
                    <input
                      type="number"
                      min={0}
                      value={costs[key] || ''}
                      onChange={e => updateCost(key, Number(e.target.value) || 0)}
                      placeholder="0"
                      style={costInputStyle}
                    />
                    <span style={{ fontSize: 12, color: colors.textMuted }}>/mo</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${colors.border}`, paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 600 }}>{t('subtotal')}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>{formatUSD(monthlyAPI)}/mo</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: '8px 12px', backgroundColor: colors.surfaceRaised, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: colors.textMuted }}>{t('monthlyTotal')}:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.danger }}>{formatUSD(monthlyTotal)}/mo</span>
          <span style={{ fontSize: 12, color: colors.textMuted }}>·</span>
          <span style={{ fontSize: 12, color: colors.textMuted }}>{t('total')} {selectedQ} (× 3):</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.danger }}>{formatUSD(qCosts)}</span>
        </div>
      </div>

      {/* Bar chart */}
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 16 }}>MRR — {selectedQ}</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fill: colors.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} width={44} />
            <Tooltip
              contentStyle={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [typeof v === 'number' ? formatUSD(v) : String(v ?? ''), 'MRR']}
              cursor={{ fill: `${colors.accent}15` }}
            />
            <Bar dataKey="mrr" fill={colors.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tables: MRR by org + Setup fees + Vendor */}
      <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'auto' }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>{t('mrrByOrg')}</div>
          <table style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Org', 'Plan', 'MRR', 'Q Rev', 'Vendor'].map(col => <th key={col} style={thStyle}>{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...activeOrgs].sort((a, b) => calcMRR(b) - calcMRR(a)).map(org => {
                const mrr = calcMRR(org)
                return (
                  <tr key={org.id}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{org.name}</td>
                    <td style={tdStyle}>
                      <span style={{ backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22', color: PLAN_COLORS[org.plan] ?? colors.accent, borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                        {org.plan}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: mrr > 0 ? colors.success : colors.textMuted, fontWeight: 600 }}>{mrr > 0 ? formatUSD(mrr) : '—'}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{mrr > 0 ? formatUSD(mrr * 3) : '—'}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{org.vendor ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {activeOrgs.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>No active organizations</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Setup fees */}
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>Setup Fees — {selectedQ}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B' }}>{formatUSD(totalSetupFees)}</span>
            </div>
            {setupOrgsList.length === 0 ? (
              <div style={{ padding: '16px 18px', color: colors.textMuted, fontSize: 13 }}>No new orgs this quarter</div>
            ) : (
              setupOrgsList.map(org => (
                <div key={org.id} style={{ padding: '10px 18px', borderBottom: `1px solid ${colors.surfaceRaised}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{org.name}</span>
                    <span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 8, textTransform: 'uppercase' }}>{org.plan}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>{formatUSD(SETUP_FEE)}</div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{new Date(org.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Vendor breakdown */}
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'auto' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${colors.border}`, fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>Revenue by Vendor</div>
            <table style={{ width: '100%', minWidth: 440, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Vendor', 'Orgs', 'MRR', 'Q Rev', 'Commission', 'Cut'].map(col => <th key={col} style={{ ...thStyle, padding: '8px 10px', fontSize: 10 }}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {vendorStats.map(({ name, count, mrr, qRevenue, commissionPct, commission }) => (
                  <tr key={name}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, padding: '9px 10px' }}>{name}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '9px 10px' }}>{count}</td>
                    <td style={{ ...tdStyle, color: colors.success, fontWeight: 600, padding: '9px 10px' }}>{formatUSD(mrr)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '9px 10px' }}>{formatUSD(qRevenue)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, padding: '9px 10px' }}>{name === 'Direct' ? '—' : `${commissionPct}%`}</td>
                    <td style={{ ...tdStyle, color: commission > 0 ? '#F59E0B' : colors.textMuted, padding: '9px 10px' }}>{commission > 0 ? formatUSD(commission) : '—'}</td>
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
