'use client'

import { useEffect, useState } from 'react'
import type { Vendor } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'

export default function VendorsPage() {
  const { colors, t } = useGlobalAdminTheme()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [commissionPct, setCommissionPct] = useState(30)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Edit
  const [editTarget, setEditTarget] = useState<Vendor | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCommission, setEditCommission] = useState(30)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => { loadVendors() }, [])

  async function loadVendors() {
    setLoading(true)
    const res = await fetch('/api/global-admin/vendors')
    const data = await res.json()
    setVendors(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/global-admin/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: email || null, commission_pct: commissionPct }),
    })
    if (res.ok) {
      setName(''); setEmail(''); setCommissionPct(30); setShowForm(false)
      await loadVendors()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Unknown error')
    }
    setSubmitting(false)
  }

  async function toggleActive(vendor: Vendor) {
    setToggling(vendor.id)
    await fetch(`/api/global-admin/vendors/${vendor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !vendor.is_active }),
    })
    setVendors(prev => prev.map(v => v.id === vendor.id ? { ...v, is_active: !v.is_active } : v))
    setToggling(null)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    await fetch(`/api/global-admin/vendors/${deleteTarget.id}`, { method: 'DELETE' })
    setVendors(prev => prev.filter(v => v.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  function openEdit(vendor: Vendor) {
    setEditTarget(vendor)
    setEditName(vendor.name)
    setEditEmail(vendor.email ?? '')
    setEditCommission(vendor.commission_pct ?? 30)
    setEditError(null)
  }

  async function handleEditSave() {
    if (!editTarget) return
    setEditSaving(true); setEditError(null)
    const res = await fetch(`/api/global-admin/vendors/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, email: editEmail || null, commission_pct: editCommission }),
    })
    const data = await res.json()
    if (!res.ok) { setEditError(data.error); setEditSaving(false); return }
    setVendors(prev => prev.map(v => v.id === editTarget.id ? data : v))
    setEditTarget(null)
    setEditSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    color: colors.textPrimary, borderRadius: 6, padding: '8px 12px', fontSize: 14, outline: 'none',
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px', fontSize: 13, color: colors.textPrimary,
    borderBottom: `1px solid ${colors.surfaceRaised}`, verticalAlign: 'middle',
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 10, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>{t('vendors')}</h1>
        <button
          onClick={() => { setShowForm(!showForm); setError(null) }}
          style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          {showForm ? '× Cancel' : `+ ${t('newVendor')}`}
        </button>
      </div>

      {showForm && (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}44`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 16 }}>{t('newVendor')}</div>
          {error && (
            <div style={{ backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, padding: '8px 12px', color: '#F87171', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 5 }}>{t('name')} *</div>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Frank" style={{ ...inputStyle, width: 160 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 5 }}>{t('email')}</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vendor@email.com" style={{ ...inputStyle, width: 200 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, marginBottom: 5 }}>{t('commissionPct')}</div>
              <input type="number" value={commissionPct} onChange={e => setCommissionPct(Number(e.target.value))} min={0} max={100} style={{ ...inputStyle, width: 80 }} />
            </div>
            <button type="submit" disabled={submitting} style={{ backgroundColor: submitting ? colors.accentHover : colors.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {submitting ? 'Adding…' : t('add')}
            </button>
          </form>
        </div>
      )}

      {loading && <div style={{ color: colors.textSecondary, textAlign: 'center', padding: 40 }}>{t('loading')}</div>}

      {!loading && vendors.length === 0 && (
        <div style={{ color: colors.textMuted, textAlign: 'center', padding: 60, fontSize: 15 }}>
          {t('noVendors')}
        </div>
      )}

      {!loading && vendors.length > 0 && (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('name'), t('email'), t('commissionPct'), t('status'), t('actions')].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map(vendor => (
                <tr key={vendor.id}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.surfaceRaised)}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{vendor.name}</td>
                  <td style={{ ...tdStyle, color: colors.textSecondary }}>{vendor.email ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#A78BFA', fontWeight: 600 }}>{vendor.commission_pct}%</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: vendor.is_active ? '#22C55E' : colors.textMuted }} />
                      <span style={{ color: vendor.is_active ? '#22C55E' : colors.textMuted, fontSize: 12 }}>
                        {vendor.is_active ? t('active') : t('inactive')}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openEdit(vendor)}
                        style={{ backgroundColor: colors.surfaceRaised, color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(vendor)}
                        disabled={toggling === vendor.id}
                        style={{
                          backgroundColor: vendor.is_active ? '#EF444422' : '#22C55E22',
                          color: vendor.is_active ? '#EF4444' : '#22C55E',
                          border: `1px solid ${vendor.is_active ? '#EF444444' : '#22C55E44'}`,
                          borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                          opacity: toggling === vendor.id ? 0.5 : 1,
                        }}
                      >
                        {toggling === vendor.id ? '…' : vendor.is_active ? t('deactivate') : t('activate')}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(vendor)}
                        style={{ backgroundColor: '#EF444422', color: '#EF4444', border: '1px solid #EF444444', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 28, width: 420, maxWidth: '94vw' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary, margin: '0 0 20px' }}>Edit Vendor</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 5 }}>Name *</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 5 }}>Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} placeholder="vendor@email.com" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, display: 'block', marginBottom: 5 }}>Commission %</label>
                <input type="number" min={0} max={100} value={editCommission} onChange={e => setEditCommission(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} />
              </div>
            </div>
            {editError && <p style={{ color: '#EF4444', fontSize: 12, margin: '12px 0 0' }}>{editError}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={handleEditSave} disabled={editSaving} style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1, opacity: editSaving ? 0.6 : 1 }}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditTarget(null)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer', flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div style={{ backgroundColor: colors.surface, border: '1px solid #EF444444', borderRadius: 12, padding: 28, width: 380, maxWidth: '94vw' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#EF4444', margin: '0 0 12px' }}>Delete Vendor</h3>
            <p style={{ color: colors.textSecondary, fontSize: 14, margin: '0 0 24px' }}>
              Are you sure you want to delete <strong style={{ color: colors.textPrimary }}>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ backgroundColor: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
