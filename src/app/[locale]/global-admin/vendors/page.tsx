'use client'

import { useEffect, useState } from 'react'
import type { Vendor } from '@/lib/types'

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [commissionPct, setCommissionPct] = useState(30)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    loadVendors()
  }, [])

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
      setName('')
      setEmail('')
      setCommissionPct(30)
      setShowForm(false)
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

  const inputStyle: React.CSSProperties = {
    backgroundColor: '#1C1C27',
    border: '1px solid #2A2A3A',
    color: '#F0F0F5',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    outline: 'none',
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
    padding: '12px 14px',
    fontSize: 13,
    color: '#F0F0F5',
    borderBottom: '1px solid #1C1C27',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>Vendors</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            backgroundColor: '#6C63FF',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showForm ? '× Cancel' : '+ Add Vendor'}
        </button>
      </div>

      {showForm && (
        <div style={{
          backgroundColor: '#13131A',
          border: '1px solid #6C63FF44',
          borderRadius: 10,
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5', marginBottom: 16 }}>New Vendor</div>
          {error && (
            <div style={{ backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, padding: '8px 12px', color: '#F87171', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: '#52526A', fontWeight: 600, marginBottom: 5 }}>Name *</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="Frank"
                style={{ ...inputStyle, width: 160 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#52526A', fontWeight: 600, marginBottom: 5 }}>Email</div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="vendor@email.com"
                style={{ ...inputStyle, width: 200 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#52526A', fontWeight: 600, marginBottom: 5 }}>Commission %</div>
              <input
                type="number"
                value={commissionPct}
                onChange={e => setCommissionPct(Number(e.target.value))}
                min={0}
                max={100}
                style={{ ...inputStyle, width: 80 }}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: submitting ? '#5A52E0' : '#6C63FF',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {submitting ? 'Adding…' : 'Add'}
            </button>
          </form>
        </div>
      )}

      {loading && <div style={{ color: '#8B8BA0', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && vendors.length === 0 && (
        <div style={{ color: '#52526A', textAlign: 'center', padding: 60, fontSize: 15 }}>
          No vendors yet. Add one above.
        </div>
      )}

      {!loading && vendors.length > 0 && (
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Commission %', 'Active', 'Actions'].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map(vendor => (
                <tr key={vendor.id}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{vendor.name}</td>
                  <td style={{ ...tdStyle, color: '#8B8BA0' }}>{vendor.email ?? '—'}</td>
                  <td style={{ ...tdStyle, color: '#A78BFA', fontWeight: 600 }}>{vendor.commission_pct}%</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: '50%',
                        backgroundColor: vendor.is_active ? '#22C55E' : '#52526A',
                      }} />
                      <span style={{ color: vendor.is_active ? '#22C55E' : '#52526A', fontSize: 12 }}>
                        {vendor.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => toggleActive(vendor)}
                      disabled={toggling === vendor.id}
                      style={{
                        backgroundColor: vendor.is_active ? '#EF444422' : '#22C55E22',
                        color: vendor.is_active ? '#EF4444' : '#22C55E',
                        border: `1px solid ${vendor.is_active ? '#EF444444' : '#22C55E44'}`,
                        borderRadius: 5,
                        padding: '4px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        opacity: toggling === vendor.id ? 0.5 : 1,
                      }}
                    >
                      {toggling === vendor.id ? '…' : vendor.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
