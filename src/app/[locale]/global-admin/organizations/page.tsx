'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import type { Organization } from '@/lib/types'
import { PLAN_PRICES } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'

type EnrichedOrg = Organization & { admin_email: string | null; sdr_count: number }

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

const MAX_INT = 2147483647

const formatSeats = (org: EnrichedOrg) => {
  if (org.max_seats == null || org.max_seats >= MAX_INT) return '∞'
  return `${org.sdr_count ?? 0}/${org.max_seats}`
}

const formatLeads = (org: Organization) => {
  if (org.max_leads_per_month == null || org.max_leads_per_month >= MAX_INT) return '∞'
  return org.max_leads_per_month.toLocaleString()
}

export default function OrganizationsPage() {
  const router = useRouter()
  const locale = useLocale()
  const { colors, t } = useGlobalAdminTheme()
  const [orgs, setOrgs] = useState<EnrichedOrg[]>([])
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

  function handleImpersonate(org: Organization) {
    setImpersonating(org.id)
    router.push(`/${locale}/kanban?impersonate_org_id=${org.id}&impersonate_org_name=${encodeURIComponent(org.name)}`)
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    color: colors.textPrimary, borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer',
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px', fontSize: 13, color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`, verticalAlign: 'middle',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>{t('organizations')}</h1>
        <a
          href={`/${locale}/global-admin/organizations/new`}
          style={{ backgroundColor: colors.accent, color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}
        >
          + {t('newOrganization')}
        </a>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={selectStyle}>
          <option value="all">{t('allPlans')}</option>
          <option value="basic">Basic</option>
          <option value="premium">Premium</option>
          <option value="enterprise">Enterprise</option>
          <option value="ultra">Ultra</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">{t('allStatus')}</option>
          <option value="active">{t('active')}</option>
          <option value="inactive">{t('inactive')}</option>
        </select>
        <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)} style={selectStyle}>
          <option value="all">{t('allVendors')}</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {loading && <div style={{ color: colors.textSecondary, padding: 40, textAlign: 'center' }}>{t('loading')}</div>}
      {error && <div style={{ color: '#EF4444', padding: 16, backgroundColor: '#3A1A1A', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: colors.textMuted, padding: 60, textAlign: 'center', fontSize: 15 }}>
          No organizations found.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('name'), t('plan'), t('seats'), t('leadsPerMonth'), t('adminEmail'), t('vendor'), t('mrr'), t('created'), t('status'), t('actions')].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(org => {
                const mrr = calcMRR(org)
                const isUltra = org.plan === 'ultra'
                return (
                  <tr
                    key={org.id}
                    style={{ transition: 'background 0.1s', cursor: 'pointer' }}
                    onClick={() => router.push(`/${locale}/global-admin/organizations/${org.id}`)}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 6,
                          backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: PLAN_COLORS[org.plan] ?? colors.accent, flexShrink: 0,
                        }}>
                          {org.name.charAt(0).toUpperCase()}
                        </div>
                        {org.name}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22',
                        color: PLAN_COLORS[org.plan] ?? colors.accent,
                        border: `1px solid ${(PLAN_COLORS[org.plan] ?? colors.accent)}44`,
                        borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {org.plan}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{formatSeats(org)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{formatLeads(org)}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary, fontSize: 12 }}>{org.admin_email ?? '—'}</td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{org.vendor ?? '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {isUltra
                        ? <span style={{ backgroundColor: colors.surfaceRaised, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{t('internal')}</span>
                        : <span style={{ color: mrr > 0 ? '#22C55E' : colors.textMuted }}>{mrr > 0 ? `$${mrr.toLocaleString()}` : '—'}</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: org.is_active ? '#22C55E' : colors.textMuted }} />
                        <span style={{ color: org.is_active ? '#22C55E' : colors.textMuted, fontSize: 12 }}>
                          {org.is_active ? t('active') : t('inactive')}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleImpersonate(org)}
                        disabled={impersonating === org.id}
                        style={{
                          backgroundColor: colors.accent + '22', color: '#A78BFA',
                          border: `1px solid ${colors.accent}44`, borderRadius: 5,
                          padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                          opacity: impersonating === org.id ? 0.5 : 1,
                        }}
                      >
                        {impersonating === org.id ? '…' : t('impersonate')}
                      </button>
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
