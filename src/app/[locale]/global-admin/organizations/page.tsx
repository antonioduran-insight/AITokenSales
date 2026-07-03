'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { X } from 'lucide-react'
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

const MAX_INT = 2147483647

const PLAN_DEFAULTS: Record<string, { max_seats: number; max_leads_per_month: number }> = {
  basic:      { max_seats: 3,        max_leads_per_month: 500 },
  premium:    { max_seats: 10,       max_leads_per_month: 2000 },
  enterprise: { max_seats: 50,       max_leads_per_month: MAX_INT },
  ultra:      { max_seats: MAX_INT,  max_leads_per_month: MAX_INT },
}

const S: Record<string, React.CSSProperties> = {
  label:  { fontSize: 12, fontWeight: 600, color: '#8B8BA0', marginBottom: 5, display: 'block' },
  input:  { width: '100%', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 7, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 7, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  btn:    { backgroundColor: '#6C63FF', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { backgroundColor: 'transparent', color: '#8B8BA0', border: '1px solid #2A2A3A', borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer' },
  row:    { marginBottom: 14 },
  grid2:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
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

function EditModal({ org, onClose, onSaved }: {
  org: Organization
  onClose: () => void
  onSaved: (updated: Organization) => void
}) {
  const [form, setForm] = useState<EditState>({
    name: org.name,
    plan: org.plan,
    max_seats: org.max_seats ?? '',
    max_leads_per_month: org.max_leads_per_month ?? '',
    billing_day: org.billing_day ?? 1,
    custom_price: org.custom_price ?? '',
    vendor: org.vendor ?? '',
    is_active: org.is_active,
    internal_notes: org.internal_notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 28, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#F0F0F5' }}>Edit Organization</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}><X size={17} /></button>
        </div>

        {/* Name */}
        <div style={S.row}>
          <label style={S.label}>Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} style={S.input} />
        </div>

        {/* Plan + Status */}
        <div style={S.grid2}>
          <div>
            <label style={S.label}>Plan</label>
            <select value={form.plan} onChange={e => set('plan', e.target.value)} style={S.select}>
              <option value="basic">Basic</option>
              <option value="premium">Premium</option>
              <option value="enterprise">Enterprise</option>
              <option value="ultra">Ultra</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <label style={{ ...S.label, marginBottom: 10 }}>Status</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: form.is_active ? '#22C55E' : '#52526A' }}>
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#6C63FF', cursor: 'pointer' }} />
              {form.is_active ? 'Active' : 'Inactive'}
            </label>
          </div>
        </div>

        {/* Seats + Leads */}
        <div style={S.grid2}>
          <div>
            <label style={S.label}>Max Seats</label>
            <input type="number" min={1} value={form.max_seats} onChange={e => set('max_seats', e.target.value === '' ? '' : Number(e.target.value))} style={S.input} placeholder="e.g. 5" />
          </div>
          <div>
            <label style={S.label}>Max Leads / Month</label>
            <input type="number" min={0} value={form.max_leads_per_month} onChange={e => set('max_leads_per_month', e.target.value === '' ? '' : Number(e.target.value))} style={S.input} placeholder="blank = unlimited" />
          </div>
        </div>

        {/* Billing day + Custom price */}
        <div style={S.grid2}>
          <div>
            <label style={S.label}>Billing Day</label>
            <input type="number" min={1} max={28} value={form.billing_day} onChange={e => set('billing_day', e.target.value === '' ? '' : Number(e.target.value))} style={S.input} />
          </div>
          <div>
            <label style={S.label}>Custom Price ($/mo) — Enterprise only</label>
            <input type="number" min={0} value={form.custom_price} onChange={e => set('custom_price', e.target.value === '' ? '' : Number(e.target.value))} style={S.input} placeholder="e.g. 4000" />
          </div>
        </div>

        {/* Vendor */}
        <div style={S.row}>
          <label style={S.label}>Vendor</label>
          <input value={form.vendor} onChange={e => set('vendor', e.target.value)} style={S.input} placeholder="e.g. Partner Name" />
        </div>

        {/* Internal notes */}
        <div style={S.row}>
          <label style={S.label}>Internal Notes</label>
          <textarea value={form.internal_notes} onChange={e => set('internal_notes', e.target.value)} rows={3}
            style={{ ...S.input, resize: 'vertical' }} placeholder="Internal notes (not visible to org)" />
        </div>

        {error && <p style={{ color: '#EF4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{ ...S.btn, flex: 1, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ ...S.btnGhost, flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
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
    setOrgs(prev => prev.map(o => o.id === updated.id ? updated : o))
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
                          onClick={() => setEditingOrg(org)}
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

      {editingOrg && (
        <EditModal
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
