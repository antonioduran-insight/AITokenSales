'use client'

import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import type { SenderProfile } from '@/lib/types'

interface Props {
  userId?: string
  onClose: () => void
  onSaved?: () => void
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (繁體)' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'vi', label: 'Vietnamese' },
]

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 },
  modal:   { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, width: 520, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', padding: 28 },
  label:   { fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', marginBottom: 6, display: 'block' },
  input:   { width: '100%', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 7, color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  btn:     { backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost:{ backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
}

export function SenderProfileModal({ userId, onClose, onSaved }: Props) {
  const [profiles, setProfiles] = useState<SenderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SenderProfile | null>(null)
  const [isNew, setIsNew] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [styleHint, setStyleHint] = useState('')
  const [icpFocusInput, setIcpFocusInput] = useState('')
  const [icpFocus, setIcpFocus] = useState<string[]>([])
  const [language, setLanguage] = useState('en')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useState(() => {
    const url = userId ? `/api/sender-profiles?user_id=${userId}` : '/api/sender-profiles'
    fetch(url)
      .then(r => r.json())
      .then((data: SenderProfile[]) => { setProfiles(data); setLoading(false) })
      .catch(() => setLoading(false))
  })

  function openNew() {
    setIsNew(true); setEditing(null)
    setDisplayName(''); setTitle(''); setCompany(''); setStyleHint('')
    setIcpFocus([]); setIcpFocusInput(''); setLanguage('en'); setIsDefault(false)
    setError(null)
  }

  function openEdit(profile: SenderProfile) {
    setIsNew(false); setEditing(profile)
    setDisplayName(profile.display_name); setTitle(profile.title)
    setCompany(profile.company); setStyleHint(profile.style_hint)
    setIcpFocus(profile.icp_focus ?? []); setIcpFocusInput(''); setLanguage(profile.language)
    setIsDefault(profile.is_default); setError(null)
  }

  function addIcpTag() {
    const tag = icpFocusInput.trim()
    if (tag && !icpFocus.includes(tag)) {
      setIcpFocus(prev => [...prev, tag])
    }
    setIcpFocusInput('')
  }

  async function handleSave() {
    if (!displayName || !title || !company) { setError('Display name, title and company are required'); return }
    setSaving(true); setError(null)
    const payload = { display_name: displayName, title, company, style_hint: styleHint, icp_focus: icpFocus, language, is_default: isDefault }

    const url = editing ? `/api/sender-profiles/${editing.id}` : '/api/sender-profiles'
    const method = editing ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }

    if (editing) {
      setProfiles(prev => prev.map(p => p.id === data.id ? data : p))
    } else {
      setProfiles(prev => [data, ...prev])
    }
    setIsNew(false); setEditing(null)
    setSaving(false)
    onSaved?.()
  }

  async function handleDelete(profile: SenderProfile) {
    const res = await fetch(`/api/sender-profiles/${profile.id}`, { method: 'DELETE' })
    if (res.ok) setProfiles(prev => prev.filter(p => p.id !== profile.id))
  }

  const showForm = isNew || editing !== null

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Sender Profiles</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><X size={16} /></button>
        </div>

        {!showForm && (
          <>
            {loading ? (
              <p style={{ color: 'var(--crm-text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>
            ) : (
              <>
                {profiles.length === 0 && (
                  <p style={{ color: 'var(--crm-text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>No sender profiles yet.</p>
                )}
                {profiles.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', backgroundColor: 'var(--crm-surface-raised)', border: `1px solid ${p.is_default ? '#6C63FF40' : 'var(--crm-border)'}`, borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{p.display_name}</span>
                        {p.is_default && <span style={{ fontSize: 10, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', border: '1px solid #6C63FF40', borderRadius: 3, padding: '1px 6px' }}>default</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{p.title} · {p.company}</div>
                      {p.style_hint && <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 4, fontStyle: 'italic' }}>"{p.style_hint}"</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(p)} style={{ fontSize: 11, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '4px 10px', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => handleDelete(p)} style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
                <button onClick={openNew} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <Plus size={14} /> New Profile
                </button>
              </>
            )}
          </>
        )}

        {showForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
              {editing ? 'Edit Profile' : 'New Profile'}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Display Name *</label>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={S.input} placeholder="John Smith" />
              </div>
              <div>
                <label style={S.label}>Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)} style={S.input} placeholder="VP Sales" />
              </div>
            </div>

            <div>
              <label style={S.label}>Company *</label>
              <input value={company} onChange={e => setCompany(e.target.value)} style={S.input} placeholder="AITokenKing" />
            </div>

            <div>
              <label style={S.label}>Style Hint</label>
              <textarea value={styleHint} onChange={e => setStyleHint(e.target.value)} rows={2}
                placeholder="Warm and analytical, focus on ROI and practical outcomes"
                style={{ ...S.input, resize: 'vertical' }} />
            </div>

            <div>
              <label style={S.label}>ICP Focus (press Enter to add)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {icpFocus.map(tag => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, backgroundColor: '#6C63FF20', color: '#A78BFA', border: '1px solid #6C63FF40', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                    {tag}
                    <button onClick={() => setIcpFocus(prev => prev.filter(t => t !== tag))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A78BFA', padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <input
                value={icpFocusInput}
                onChange={e => setIcpFocusInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addIcpTag())}
                placeholder="CTO, Founder, VP Engineering…"
                style={S.input}
              />
            </div>

            <div>
              <label style={S.label}>Language</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={{ ...S.input }}>
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--crm-text-primary)' }}>
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14 }} />
              Use as default profile for new runs
            </label>

            {error && <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Profile'}
              </button>
              <button onClick={() => { setIsNew(false); setEditing(null) }} style={S.btnGhost}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
