'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { Button } from '@/components/ui/button'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Plus, Eye, EyeOff, Trash2, UserMinus, ShieldAlert, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import type { User, Area } from '@/lib/types'

interface UserWithArea extends User {
  area?: Area
  user_areas?: { area: Area }[]
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: 'var(--crm-text-primary)', height: '100%', display: 'flex', flexDirection: 'column' },
  modal: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modalCard: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw' },
  input: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const },
  label: { fontSize: 12, color: 'var(--crm-text-secondary)', display: 'block', marginBottom: 6 },
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <div
      onClick={disabled ? undefined : onChange}
      style={{
        width: 36, height: 20, backgroundColor: checked ? '#22C55E' : 'var(--crm-text-muted)',
        borderRadius: 10, position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
        backgroundColor: '#fff', borderRadius: '50%', transition: 'left 0.2s',
      }} />
    </div>
  )
}

export function UsersManagement() {
  const t = useTranslations('users')

  const [users, setUsers] = useState<UserWithArea[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [maxSeats, setMaxSeats] = useState<number>(999)
  const [showSeatLimit, setShowSeatLimit] = useState(false)

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formRole, setFormRole] = useState<'sdr' | 'admin'>('sdr')
  const [formAreaIds, setFormAreaIds] = useState<string[]>([])
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit modal
  const [editUser, setEditUser] = useState<UserWithArea | null>(null)
  const [editName, setEditName] = useState('')
  const [editAreaIds, setEditAreaIds] = useState<string[]>([])
  const [editRole, setEditRole] = useState<'sdr' | 'admin'>('sdr')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Confirm modals
  const [confirmUser, setConfirmUser] = useState<UserWithArea | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deleteUser, setDeleteUser] = useState<UserWithArea | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [unassignUser, setUnassignUser] = useState<UserWithArea | null>(null)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignSuccess, setUnassignSuccess] = useState<string | null>(null)

  useEffect(() => {
    createClient().from('areas').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setAreas(data as Area[])
    })
    fetch('/api/users').then(r => r.json()).then(d => { if (d.max_seats) setMaxSeats(d.max_seats) })
  }, [])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await createClient()
        .from('users')
        .select('*, area:areas(*), user_areas(area:areas(*))')
        .order('role')
        .order('full_name')
      if (data) setUsers(data as UserWithArea[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function resetForm() { setFormName(''); setFormEmail(''); setFormPassword(''); setFormAreaIds([]); setCreateError(''); setShowPassword(false); setFormRole('sdr') }

  function toggleAreaId(id: string) { setFormAreaIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]) }
  function toggleEditAreaId(id: string) { setEditAreaIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]) }

  function openEdit(u: UserWithArea) {
    const currentAreas = (u.user_areas ?? []).map(ua => ua.area?.id).filter(Boolean) as string[]
    const areas = currentAreas.length > 0 ? currentAreas : (u.area_id ? [u.area_id] : [])
    setEditUser(u)
    setEditName(u.full_name)
    setEditAreaIds(areas)
    setEditRole(u.role as 'sdr' | 'admin')
    setEditError('')
  }

  async function handleEditSave() {
    if (!editUser || !editName.trim()) { setEditError('Name is required'); return }
    setEditSaving(true); setEditError('')
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editUser.id,
          action: 'edit',
          full_name: editName.trim(),
          role: editRole,
          area_ids: editAreaIds,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setEditError(json.error ?? 'Failed to save'); return }
      setEditUser(null)
      fetchUsers()
    } finally { setEditSaving(false) }
  }

  async function handleCreateClick() {
    const activeSdrs = users.filter(u => u.role === 'sdr' && u.is_active).length
    if (activeSdrs >= maxSeats) { setShowSeatLimit(true); return }
    resetForm(); setShowForm(true)
  }

  async function handleCreate() {
    if (!formName || !formEmail || !formPassword) { setCreateError(t('allFieldsRequired')); return }
    if (formPassword.length < 8) { setCreateError(t('passwordMinLength')); return }
    setCreating(true); setCreateError('')
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: formName, email: formEmail, password: formPassword, area_ids: formAreaIds, area_id: formAreaIds[0] ?? null, role: formRole }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'seat_limit_reached') { setShowForm(false); setShowSeatLimit(true); return }
        setCreateError(json.error ?? 'Failed to create user'); return
      }
      await logAuditEvent({ event_type: 'sdr_created', metadata: { name: formName, email: formEmail, area_ids: formAreaIds } })
      setShowForm(false); resetForm(); fetchUsers()
    } finally { setCreating(false) }
  }

  async function handleToggleActive(u: UserWithArea) {
    if (u.role === 'admin') return
    if (!u.is_active) {
      setDeactivating(true)
      await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, is_active: true }) })
      fetchUsers(); setDeactivating(false); return
    }
    setConfirmUser(u)
  }

  async function confirmDeactivate() {
    if (!confirmUser) return
    setDeactivating(true)
    try {
      await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: confirmUser.id, is_active: false }) })
      await logAuditEvent({ event_type: 'sdr_deactivated', metadata: { name: confirmUser.full_name } })
      setConfirmUser(null); fetchUsers()
    } finally { setDeactivating(false) }
  }

  async function handleScraperToggle(u: UserWithArea) {
    await createClient().from('users').update({ scraper_access: !u.scraper_access }).eq('id', u.id)
    fetchUsers()
  }

  async function confirmUnassign() {
    if (!unassignUser) return
    setUnassigning(true)
    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: unassignUser.id, action: 'unassign' }) })
      const json = await res.json()
      if (!res.ok) return
      await logAuditEvent({ event_type: 'prospect_reassigned', metadata: { from_sdr: unassignUser.full_name, to_sdr: 'Unassigned', action: 'bulk_unassign', count: json.count } })
      setUnassignSuccess(`${json.count ?? 0} leads unassigned from ${unassignUser.full_name}`)
      setUnassignUser(null)
      setTimeout(() => setUnassignSuccess(null), 4000)
    } finally { setUnassigning(false) }
  }

  async function confirmDelete() {
    if (!deleteUser) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deleteUser.id }) })
      const json = await res.json()
      if (!res.ok) { setDeleteError(json.error ?? 'Failed to delete'); return }
      await logAuditEvent({ event_type: 'sdr_deactivated', metadata: { name: deleteUser.full_name, action: 'deleted' } })
      setDeleteUser(null); fetchUsers()
    } finally { setDeleting(false) }
  }

  function getAreas(u: UserWithArea): Area[] {
    const fromUserAreas = (u.user_areas ?? []).map(ua => ua.area).filter(Boolean) as Area[]
    if (fromUserAreas.length > 0) return fromUserAreas
    return u.area ? [u.area] : []
  }

  const activeSdrCount = users.filter(u => u.role === 'sdr' && u.is_active).length

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('title')}</h1>
          <div style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginTop: 4 }}>
            {activeSdrCount} / {maxSeats === 999 ? '∞' : maxSeats} seats used
          </div>
        </div>
        <Button onClick={handleCreateClick} style={{ backgroundColor: activeSdrCount >= maxSeats ? 'var(--crm-border)' : 'var(--crm-accent)', color: '#FFF', height: 34, fontSize: 13, gap: 6, display: 'flex', alignItems: 'center' }}>
          <Plus size={14} /> {t('createSDR')}
        </Button>
      </div>

      {loading && <div style={{ color: 'var(--crm-text-muted)', textAlign: 'center', padding: 48 }}>Loading…</div>}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, overflowY: 'auto', flex: 1 }}>
          {users.map(u => {
            const userAreas = getAreas(u)
            const isAdminUser = u.role === 'admin'
            return (
              <div
                key={u.id}
                style={{
                  backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 20,
                  opacity: u.is_active ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 12,
                }}
              >
                {/* Avatar + name + role */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', backgroundColor: 'var(--crm-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, color: isAdminUser ? '#EC4899' : 'var(--crm-accent)', flexShrink: 0,
                  }}>
                    {u.full_name[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--crm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--crm-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  </div>
                  <span style={{ backgroundColor: isAdminUser ? '#EC489920' : '#6C63FF20', color: isAdminUser ? '#EC4899' : 'var(--crm-accent)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
                    {u.role}
                  </span>
                </div>

                {/* Markets */}
                {userAreas.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {userAreas.map(a => <AreaBadge key={a.id} area={a} size="sm" />)}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>No markets assigned</div>
                )}

                {/* Toggles row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Toggle checked={u.is_active} onChange={() => handleToggleActive(u)} disabled={isAdminUser || deactivating} />
                    <span style={{ fontSize: 12, color: u.is_active ? '#22C55E' : 'var(--crm-text-muted)', fontWeight: 600 }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {!isAdminUser && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={u.scraper_access ?? false}
                        onChange={() => handleScraperToggle(u)}
                        style={{ accentColor: 'var(--crm-accent)', width: 13, height: 13 }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>Scraper</span>
                    </label>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginLeft: 'auto' }}>
                    {format(new Date(u.created_at), 'MMM d, yyyy')}
                  </span>
                </div>

                {/* Actions: Unassign (SDR only) | Edit | Delete */}
                <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--crm-surface-raised)', paddingTop: 12 }}>
                  {!isAdminUser && (
                    <button
                      onClick={() => setUnassignUser(u)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: '1px solid #F59E0B40', backgroundColor: '#F59E0B10', color: '#F59E0B' }}
                    >
                      <UserMinus size={12} /> Unassign
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(u)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: '1px solid #6C63FF40', backgroundColor: '#6C63FF10', color: 'var(--crm-accent)' }}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => { setDeleteError(''); setDeleteUser(u) }}
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: '1px solid #EF444440', backgroundColor: '#EF444410', color: '#EF4444', marginLeft: 'auto' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Seat limit modal */}
      {showSeatLimit && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setShowSeatLimit(false) }}>
          <div style={{ ...S.modalCard, maxWidth: 380, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#F59E0B20', border: '1px solid #F59E0B40', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <ShieldAlert size={22} color="#F59E0B" />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#F59E0B', marginBottom: 10 }}>Seat Limit Reached</h2>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              Your plan allows <strong style={{ color: 'var(--crm-text-primary)' }}>{maxSeats}</strong> active SDR{maxSeats !== 1 ? 's' : ''}. Deactivate an existing SDR or upgrade your plan.
            </p>
            <Button onClick={() => setShowSeatLimit(false)} style={{ backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)', width: '100%' }}>Close</Button>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showForm && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div style={S.modalCard}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>{t('createSDR')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>{t('name')} *</label>
                <input style={S.input} value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('namePlaceholder')} />
              </div>
              <div>
                <label style={S.label}>{t('email')} *</label>
                <input style={S.input} type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder={t('emailPlaceholder')} />
              </div>
              <div>
                <label style={S.label}>{t('tempPassword')} *</label>
                <div style={{ position: 'relative' }}>
                  <input style={{ ...S.input, paddingRight: 36 }} type={showPassword ? 'text' : 'password'} value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder={t('passwordPlaceholder')} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPassword(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--crm-text-muted)', cursor: 'pointer', padding: 0 }}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={S.label}>Role</label>
                <select value={formRole} onChange={e => setFormRole(e.target.value as 'sdr' | 'admin')} style={{ ...S.input, cursor: 'pointer' }}>
                  <option value="sdr">SDR</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label style={S.label}>Markets (select all that apply)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {areas.map(a => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 6, border: `1px solid ${formAreaIds.includes(a.id) ? '#6C63FF40' : 'var(--crm-border)'}`, backgroundColor: formAreaIds.includes(a.id) ? '#6C63FF10' : 'transparent' }}>
                      <input type="checkbox" checked={formAreaIds.includes(a.id)} onChange={() => toggleAreaId(a.id)} style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14 }} />
                      <AreaBadge area={a} size="sm" />
                      <span style={{ fontSize: 13, color: 'var(--crm-text-primary)' }}>{a.label_en}</span>
                    </label>
                  ))}
                </div>
              </div>
              {createError && (
                <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12 }}>{createError}</div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <Button onClick={() => { setShowForm(false); resetForm() }} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>{t('cancel')}</Button>
                <Button onClick={handleCreate} disabled={creating} style={{ flex: 1, backgroundColor: 'var(--crm-accent)', color: '#FFF' }}>{creating ? t('creating') : t('createSDR')}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setEditUser(null) }}>
          <div style={S.modalCard}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Edit User</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>Full Name *</label>
                <input style={S.input} value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Role</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value as 'sdr' | 'admin')} style={{ ...S.input, cursor: 'pointer' }}>
                  <option value="sdr">SDR</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label style={S.label}>Markets</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {areas.map(a => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 6, border: `1px solid ${editAreaIds.includes(a.id) ? '#6C63FF40' : 'var(--crm-border)'}`, backgroundColor: editAreaIds.includes(a.id) ? '#6C63FF10' : 'transparent' }}>
                      <input type="checkbox" checked={editAreaIds.includes(a.id)} onChange={() => toggleEditAreaId(a.id)} style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14 }} />
                      <AreaBadge area={a} size="sm" />
                      <span style={{ fontSize: 13, color: 'var(--crm-text-primary)' }}>{a.label_en}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editError && (
                <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12 }}>{editError}</div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button onClick={() => setEditUser(null)} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>Cancel</Button>
                <Button onClick={handleEditSave} disabled={editSaving} style={{ flex: 1, backgroundColor: 'var(--crm-accent)', color: '#FFF' }}>{editSaving ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unassign modal */}
      {unassignUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setUnassignUser(null) }}>
          <div style={{ ...S.modalCard, maxWidth: 380 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B', marginBottom: 12 }}>Unassign leads</h2>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              All leads assigned to <strong style={{ color: 'var(--crm-text-primary)' }}>{unassignUser.full_name}</strong> will become <strong style={{ color: 'var(--crm-text-primary)' }}>unassigned</strong>. Leads are not deleted.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setUnassignUser(null)} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>{t('cancel')}</Button>
              <Button onClick={confirmUnassign} disabled={unassigning} style={{ flex: 1, backgroundColor: '#F59E0B', color: '#000', fontWeight: 700 }}>
                {unassigning ? 'Unassigning...' : 'Unassign'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setDeleteUser(null) }}>
          <div style={{ ...S.modalCard, maxWidth: 380 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#EF4444', marginBottom: 12 }}>Delete User</h2>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
              This will <strong style={{ color: 'var(--crm-text-primary)' }}>permanently delete</strong> <strong style={{ color: 'var(--crm-text-primary)' }}>{deleteUser.full_name}</strong> from the platform.
            </p>
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 20 }}>
              {deleteUser.role === 'sdr' ? 'Their leads will become unassigned. ' : ''}This action cannot be undone.
            </p>
            {deleteError && <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12, marginBottom: 14 }}>{deleteError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setDeleteUser(null)} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>{t('cancel')}</Button>
              <Button onClick={confirmDelete} disabled={deleting} style={{ flex: 1, backgroundColor: '#EF4444', color: '#FFF' }}>
                <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate confirm modal */}
      {confirmUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setConfirmUser(null) }}>
          <div style={{ ...S.modalCard, maxWidth: 360 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#EF4444' }}>{t('deactivateTitle')}</h2>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
              {t('deactivateConfirm', { name: confirmUser.full_name })}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setConfirmUser(null)} style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>{t('cancel')}</Button>
              <Button onClick={confirmDeactivate} disabled={deactivating} style={{ flex: 1, backgroundColor: '#EF4444', color: '#FFF' }}>
                {deactivating ? t('deactivating') : t('deactivate')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Unassign success toast */}
      {unassignSuccess && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, backgroundColor: '#1C2A1C', border: '1px solid #22C55E40', borderRadius: 8, padding: '12px 18px', color: '#22C55E', fontSize: 13, fontWeight: 500, zIndex: 100 }}>
          ✓ {unassignSuccess}
        </div>
      )}
    </div>
  )
}
