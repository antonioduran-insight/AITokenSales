'use client'

import { useEffect, useState } from 'react'
import type { Organization } from '@/lib/types'
import { PLAN_PRICES } from '@/lib/types'

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
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/global-admin/organizations')
      .then(r => r.json())
      .then(data => { setOrgs(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const activeOrgs = orgs.filter(o => o.is_active)
  const totalMRR = orgs.reduce((sum, o) => sum + calcMRR(o), 0)
  const activeClients = activeOrgs.length
  const ultraClients = orgs.filter(o => o.plan === 'ultra').length
  const payingClients = activeOrgs.filter(o => o.plan !== 'ultra').length

  // MRR table sorted by MRR desc
  const mrrTable = [...orgs].sort((a, b) => calcMRR(b) - calcMRR(a))

  // Revenue by plan
  const plans = ['basic', 'premium', 'enterprise'] as const
  const planStats = plans.map(p => {
    const planOrgs = orgs.filter(o => o.plan === p)
    const mrr = planOrgs.reduce((sum, o) => sum + calcMRR(o), 0)
    return { plan: p, count: planOrgs.length, mrr }
  })

  // Revenue by vendor
  const vendorMap = new Map<string, { count: number; mrr: number }>()
  orgs.forEach(o => {
    const v = o.vendor ?? 'direct'
    const existing = vendorMap.get(v) ?? { count: 0, mrr: 0 }
    vendorMap.set(v, { count: existing.count + 1, mrr: existing.mrr + calcMRR(o) })
  })
  const vendorStats = Array.from(vendorMap.entries()).map(([name, stats]) => ({
    name,
    ...stats,
    commission: name === 'direct' ? 0 : Math.round(stats.mrr * 0.3),
  })).sort((a, b) => b.mrr - a.mrr)

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#13131A',
    border: '1px solid #2A2A3A',
    borderRadius: 10,
    padding: '20px 24px',
    flex: 1,
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#52526A',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid #2A2A3A',
  }

  const tdStyle: React.CSSProperties = {
    padding: '11px 14px',
    fontSize: 13,
    color: '#F0F0F5',
    borderBottom: '1px solid #1C1C27',
  }

  if (loading) {
    return <div style={{ color: '#8B8BA0', padding: 60, textAlign: 'center' }}>Loading…</div>
  }

  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0F0F5', marginBottom: 28 }}>Revenue</h1>

      {/* Stats cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: '#52526A', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>MRR Total</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#22C55E' }}>${totalMRR.toLocaleString()}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: '#52526A', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Active Clients</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#F0F0F5' }}>{activeClients}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: '#52526A', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Ultra Clients</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#EF4444' }}>{ultraClients}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: '#52526A', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Paying Clients</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#A78BFA' }}>{payingClients}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        {/* Revenue by plan */}
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5', marginBottom: 16 }}>Revenue by Plan</div>
          {planStats.map(({ plan, count, mrr }) => (
            <div key={plan} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: PLAN_COLORS[plan], fontWeight: 600, textTransform: 'capitalize' }}>{plan}</span>
                <span style={{ color: '#8B8BA0' }}>{count} orgs · <span style={{ color: '#22C55E', fontWeight: 600 }}>${mrr.toLocaleString()}</span></span>
              </div>
              <div style={{ height: 6, backgroundColor: '#2A2A3A', borderRadius: 3, overflow: 'hidden' }}>
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
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5', marginBottom: 16 }}>Revenue by Vendor</div>
          {vendorStats.length === 0 && <div style={{ color: '#52526A', fontSize: 13 }}>No data</div>}
          {vendorStats.map(({ name, count, mrr, commission }) => (
            <div key={name} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: '#F0F0F5', fontWeight: 600 }}>{name}</span>
                <span style={{ color: '#8B8BA0' }}>
                  {count} orgs ·{' '}
                  <span style={{ color: '#22C55E', fontWeight: 600 }}>${mrr.toLocaleString()}</span>
                  {commission > 0 && <span style={{ color: '#F59E0B' }}> · ${commission.toLocaleString()} comm.</span>}
                </span>
              </div>
              <div style={{ height: 6, backgroundColor: '#2A2A3A', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: totalMRR > 0 ? `${Math.round((mrr / totalMRR) * 100)}%` : '0%',
                  backgroundColor: '#6C63FF',
                  borderRadius: 3,
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MRR Table */}
      <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A3A', fontSize: 14, fontWeight: 600, color: '#F0F0F5' }}>
          MRR by Organization
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Organization', 'Plan', 'MRR', 'Vendor', 'Created'].map(col => (
                <th key={col} style={thStyle}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mrrTable.map(org => {
              const mrr = calcMRR(org)
              return (
                <tr key={org.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{org.name}</td>
                  <td style={tdStyle}>
                    <span style={{
                      backgroundColor: (PLAN_COLORS[org.plan] ?? '#6C63FF') + '22',
                      color: PLAN_COLORS[org.plan] ?? '#6C63FF',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                    }}>
                      {org.plan}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: mrr > 0 ? '#22C55E' : '#52526A', fontWeight: 600 }}>
                    {mrr > 0 ? `$${mrr.toLocaleString()}` : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: '#8B8BA0' }}>{org.vendor ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#8B8BA0' }}>{new Date(org.created_at).toLocaleDateString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {mrrTable.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#52526A', fontSize: 14 }}>No organizations</div>
        )}
      </div>
    </div>
  )
}
