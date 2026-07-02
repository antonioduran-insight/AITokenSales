'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
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

export default function OrganizationsPage() {
  const router = useRouter()
  const locale = useLocale()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterPlan, setFilterPlan] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterVendor, setFilterVendor] = useState('all')
  const [impersonating, setImpersonating] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/global-admin/organizations')
      .then(r => r.json())
      .then(data => { setOrgs(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const vendors = Array.from(new Set(orgs.map(o => o.vendor).filter(Boolean))) as string[]

  const filtered = orgs.filter(o => {
    if (filterPlan !== 'all' && o.plan !== filterPlan) return false
    if (filterStatus === 'active' && !o.is_active) return false
    if (filterStatus === 'inactive' && o.is_active) return false
    if (filterVendor !== 'all' && o.vendor !== filterVendor) return false
    return true
  })

  async function handleImpersonate(org: Organization) {
    setImpersonating(org.id)
    const res = await fetch('/api/global-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: org.id, org_name: org.name }),
    })
    if (res.ok) {
      router.push(`/${locale}/kanban`)
    } else {
      setImpersonating(null)
    }
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: '#1C1C27',
    border: '1px solid #2A2A3A',
    color: '#F0F0F5',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
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
    whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: 13,
    color: '#F0F0F5',
    borderBottom: '1px solid #1C1C27',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>Organizations</h1>
        <a
          href={`/${locale}/global-admin/organizations/new`}
          style={{
            backgroundColor: '#6C63FF',
            color: '#F0F0F5',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          + New Organization
        </a>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={selectStyle}>
          <option value="all">All Plans</option>
          <option value="basic">Basic</option>
          <option value="premium">Premium</option>
          <option value="enterprise">Enterprise</option>
          <option value="ultra">Ultra</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)} style={selectStyle}>
          <option value="all">All Vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {loading && <div style={{ color: '#8B8BA0', padding: 40, textAlign: 'center' }}>Loading…</div>}
      {error && <div style={{ color: '#EF4444', padding: 16, backgroundColor: '#3A1A1A', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: '#52526A', padding: 60, textAlign: 'center', fontSize: 15 }}>
          No organizations found.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Plan', 'Seats', 'Leads/mo', 'Vendor', 'MRR', 'Created', 'Status', 'Actions'].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(org => {
                const mrr = calcMRR(org)
                return (
                  <tr key={org.id} style={{ transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{org.name}</td>
                    <td style={tdStyle}>
                      <span style={{
                        backgroundColor: (PLAN_COLORS[org.plan] ?? '#6C63FF') + '22',
                        color: PLAN_COLORS[org.plan] ?? '#6C63FF',
                        border: `1px solid ${PLAN_COLORS[org.plan] ?? '#6C63FF'}44`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}>
                        {org.plan}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#8B8BA0' }}>?/{org.max_seats}</td>
                    <td style={{ ...tdStyle, color: '#8B8BA0' }}>
                      {org.max_leads_per_month != null ? org.max_leads_per_month.toLocaleString() : '∞'}
                    </td>
                    <td style={{ ...tdStyle, color: '#8B8BA0' }}>{org.vendor ?? '—'}</td>
                    <td style={{ ...tdStyle, color: mrr > 0 ? '#22C55E' : '#52526A', fontWeight: 600 }}>
                      {mrr > 0 ? `$${mrr.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#8B8BA0' }}>
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: '50%',
                          backgroundColor: org.is_active ? '#22C55E' : '#52526A',
                        }} />
                        <span style={{ color: org.is_active ? '#22C55E' : '#52526A', fontSize: 12 }}>
                          {org.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleImpersonate(org)}
                          disabled={impersonating === org.id}
                          style={{
                            backgroundColor: '#6C63FF22',
                            color: '#A78BFA',
                            border: '1px solid #6C63FF44',
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                            opacity: impersonating === org.id ? 0.5 : 1,
                          }}
                        >
                          {impersonating === org.id ? '…' : 'Impersonate'}
                        </button>
                        <button
                          onClick={() => alert('Edit coming soon')}
                          style={{
                            backgroundColor: '#1C1C27',
                            color: '#8B8BA0',
                            border: '1px solid #2A2A3A',
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
