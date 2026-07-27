'use client'

import { useEffect, useState } from 'react'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { X } from 'lucide-react'

interface SupportUser {
  id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
}

export default function GlobalAdminSupportPage() {
  const { colors, t } = useGlobalAdminTheme()
  const [users, setUsers] = useState<SupportUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  // `loading` starts true (initial state below) — only reset it back to
  // true here if a future caller needs a manual refresh, to keep the
  // mount effect free of a synchronous setState call.
  function load() {
    fetch('/api/global-admin/support-users')
      .then(r => r.json())
      .then(data => { setUsers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function createSupportUser() {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setFormError('All fields are required')
      return
    }
    setCreating(true)
    setFormError('')
    try {
      const res = await fetch('/api/global-admin/support-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setFormError(data.error ?? 'Failed to create user'); return }
      setShowNew(false)
      setFullName(''); setEmail(''); setPassword('')
      load()
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(u: SupportUser) {
    setTogglingId(u.id)
    try {
      const res = await fetch('/api/global-admin/support-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, is_active: !u.is_active }),
      })
      if (res.ok) setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x))
    } finally {
      setTogglingId(null)
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    color: colors.textPrimary, borderRadius: 6, padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: colors.textSecondary, fontWeight: 600, display: 'block', marginBottom: 6 }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: '0 0 4px' }}>{t('support')}</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
            Internal staff accounts — org-independent, manage support tickets across every organization.
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setFormError('') }}
          style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + New Support User
        </button>
      </div>

      {loading && <div style={{ color: colors.textSecondary, padding: 40, textAlign: 'center' }}>{t('loading')}</div>}
      {error && <div style={{ color: '#EF4444', padding: 16, backgroundColor: '#3A1A1A', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {!loading && users.length === 0 && (
        <div style={{ color: colors.textMuted, padding: 60, textAlign: 'center', fontSize: 15 }}>
          No Support accounts yet.
        </div>
      )}

      {!loading && users.length > 0 && (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('name'), t('email'), t('status'), t('actions')].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{u.full_name}</td>
                  <td style={{ ...tdStyle, color: colors.textSecondary }}>{u.email}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: u.is_active ? '#22C55E' : colors.textMuted }} />
                      <span style={{ color: u.is_active ? '#22C55E' : colors.textMuted, fontSize: 12 }}>
                        {u.is_active ? t('active') : t('inactive')}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={togglingId === u.id}
                      style={{
                        backgroundColor: 'transparent', color: u.is_active ? '#EF4444' : '#22C55E',
                        border: `1px solid ${u.is_active ? '#EF444444' : '#22C55E44'}`, borderRadius: 5,
                        padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                        opacity: togglingId === u.id ? 0.5 : 1,
                      }}
                    >
                      {u.is_active ? 'Deactivate' : t('activate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false) }}
        >
          <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 24, width: 420, maxWidth: '92vw', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>New Support User</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('name')}</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} style={inputStyle} placeholder="Jane Doe" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('email')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} placeholder="support@insight.software" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('temporaryPassword')}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} autoComplete="new-password" />
            </div>

            {formError && (
              <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12, marginBottom: 14 }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowNew(false)}
                style={{ flex: 1, backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 7, padding: '9px 0', fontSize: 13, cursor: 'pointer' }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={createSupportUser}
                disabled={creating}
                style={{ flex: 1, backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1 }}
              >
                {creating ? t('saving') : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
