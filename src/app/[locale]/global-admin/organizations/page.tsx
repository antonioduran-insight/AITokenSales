'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { X } from 'lucide-react'
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

const PLAN_DEFAULTS: Record<string, { max_seats: number; max_leads_per_month: number }> = {
  basic:      { max_seats: 3,        max_leads_per_month: 1000 },
  premium:    { max_seats: 10,       max_leads_per_month: 3000 },
  enterprise: { max_seats: 15,       max_leads_per_month: 10000 },
  ultra:      { max_seats: MAX_INT,  max_leads_per_month: MAX_INT },
}

const formatSeats = (org: EnrichedOrg) => {
  if (!org.max_seats || org.max_seats >= MAX_INT) return '∞'
  return `${org.sdr_count ?? 0}/${org.max_seats}`
}

const formatLeads = (org: Organization) => {
  if (!org.max_leads_per_month || org.max_leads_per_month >= MAX_INT) return '∞'
  return org.max_leads_per_month.toLocaleString()
}

interface EditState {
  name: string
  plan: string
  max_seats: number | ''
  max_leads_per_month: number | ''
  billing_day: number | ''
  custom_price: number | ''
  vendor: string
  is_active: boolean
  internal_notes: string
}

function EditModal({ org, onClose, onSaved, colors }: {
  org: Organization
  onClose: () => void
  onSaved: (updated: Organization) => void
  colors: ReturnType<typeof useGlobalAdminTheme>['colors']
}) {
  const [form, setForm] = useState<EditState>({
    name: org.name,
    plan: org.plan,
    max_seats: org.max_seats ?? '',
    max_leads_per_month: org.max_leads_per_month ?? '',
    billing_day: org.billing_day ?? 10,
    custom_price: org.custom_price ?? '',
    vendor: org.vendor ?? '',
    is_active: org.is_active,
    internal_notes: org.internal_notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputStyle: React.CSSProperties = {
    width: '100%', backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    borderRadius: 7, color: colors.textPrimary, padding: '8px 12px', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 5, display: 'block',
  }

  function set<K extends keyof EditState>(key: K, value: EditState[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'plan') {
        const defaults = PLAN_DEFAULTS[value as string]
        if (defaults) {
          next.max_seats = defaults.max_seats
          next.max_leads_per_month = defaults.max_leads_per_month
        }
      }
      return next
    })
  }

  async function save() {
    setSaving(true); setError(null)
    const res = await fetch('/api/global-admin/organizations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: org.id,
        name: form.name.trim(),
        plan: form.plan,
        max_seats: form.max_seats === '' ? null : Number(form.max_seats),
        max_leads_per_month: form.max_leads_per_month === '' ? null : Number(form.max_leads_per_month),
        billing_day: form.billing_day === '' ? 1 : Number(form.billing_day),
        custom_price: form.custom_price === '' ? null : Number(form.custom_price),
        vendor: form.vendor.trim() || null,
        is_active: form.is_active,
        internal_notes: form.internal_notes.trim() || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    onSaved(data as Organization)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
      <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 28, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: colors.textPrimary }}>Edit Organization</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted }}><X size={17} /></button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Plan</label>
            <select value={form.plan} onChange={e => set('plan', e.target.value)} style={inputStyle}>
              <option value="basic">Basic</option>
              <option value="premium">Premium</option>
              <option value="enterprise">Enterprise</option>
              <option value="ultra">Ultra</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Status</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: form.is_active ? '#22C55E' : colors.textMuted }}>
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: colors.accent, cursor: 'pointer' }} />
              {form.is_active ? 'Active' : 'Inactive'}
            </label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Max Seats</label>
            <input type="number" min={1} value={form.max_seats} onChange={e => set('max_seats', e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} placeholder="e.g. 5" />
          </div>
          <div>
            <label style={labelStyle}>Max Leads / Month</label>
            <input type="number" min={0} value={form.max_leads_per_month} onChange={e => set('max_leads_per_month', e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} placeholder="blank = unlimited" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Billing Day</label>
            <input type="number" min={1} max={28} value={form.billing_day} onChange={e => set('billing_day', e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Custom Price ($/mo) — Enterprise only</label>
            <input type="number" min={0} value={form.custom_price} onChange={e => set('custom_price', e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} placeholder="e.g. 4000" />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Vendor</label>
          <input value={form.vendor} onChange={e => set('vendor', e.target.value)} style={inputStyle} placeholder="e.g. Partner Name" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Internal Notes</label>
          <textarea value={form.internal_notes} onChange={e => set('internal_notes', e.target.value)} rows={3}
            style={{ ...inputStyle, resize: 'vertical' }} placeholder="Internal notes (not visible to org)" />
        </div>

        {error && <p style={{ color: '#EF4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer', flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
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
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)

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

  function handleSaved(updated: Organization) {
    setOrgs(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    color: colors.textPrimary,
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
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: 13,
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`,
    verticalAlign: 'middle',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>{t('organizations')}</h1>
        <a
          href={`/${locale}/global-admin/organizations/new`}
          style={{
            backgroundColor: colors.accent,
            color: '#fff',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-block',
          }}
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
                          fontSize: 12, fontWeight: 700,
                          color: PLAN_COLORS[org.plan] ?? colors.accent,
                          flexShrink: 0,
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
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
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
                        <div style={{
                          width: 7, height: 7, borderRadius: '50%',
                          backgroundColor: org.is_active ? '#22C55E' : colors.textMuted,
                        }} />
                        <span style={{ color: org.is_active ? '#22C55E' : colors.textMuted, fontSize: 12 }}>
                          {org.is_active ? t('active') : t('inactive')}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleImpersonate(org)}
                          disabled={impersonating === org.id}
                          style={{
                            backgroundColor: colors.accent + '22',
                            color: '#A78BFA',
                            border: `1px solid ${colors.accent}44`,
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                            opacity: impersonating === org.id ? 0.5 : 1,
                          }}
                        >
                          {impersonating === org.id ? '…' : t('impersonate')}
                        </button>
                        <button
                          onClick={() => setEditingOrg(org)}
                          style={{
                            backgroundColor: colors.surfaceRaised,
                            color: colors.textSecondary,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {t('edit')}
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

      {editingOrg && (
        <EditModal
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={handleSaved}
          colors={colors}
        />
      )}
    </div>
  )
}
