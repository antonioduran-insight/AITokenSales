'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { Button } from '@/components/ui/button'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { Plus, UserX, UserCheck, RefreshCw, Eye, EyeOff, Trash2, UserMinus, ShieldAlert } from 'lucide-react'
import { format } from 'date-fns'
import type { User, Area } from '@/lib/types'

interface UserWithArea extends User {
  area?: Area
  user_areas?: { area: Area }[]
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', height: '100%', display: 'flex', flexDirection: 'column' },
  modal: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modalCard: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw' },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const },
  label: { fontSize: 12, color: '#8B8BA0', display: 'block', marginBottom: 6 },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #2A2A3A', whiteSpace: 'nowrap' as const },
  td: { padding: '11px 14px', borderBottom: '1px solid #1C1C27', fontSize: 13, verticalAlign: 'middle' as const },
}

export function UsersManagement() {
  const t = useTranslations('users')

  const [users, setUsers] = useState<UserWithArea[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)

  // Org seat info
  const [maxSeats, setMaxSeats] = useState<number>(999)
  const [showSeatLimit, setShowSeatLimit] = useState(false)

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formAreaIds, setFormAreaIds] = useState<string[]>([])
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Deactivate confirm
  const [confirmUser, setConfirmUser] = useState<UserWithArea | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  // Delete confirm
  const [deleteUser, setDeleteUser] = useState<UserWithArea | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Unassign leads
  const [unassignUser, setUnassignUser] = useState<UserWithArea | null>(null)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignSuccess, setUnassignSuccess] = useState<string | null>(null)

  useEffect(() => {
    createClient().from('areas').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setAreas(data as Area[])
    })
    fetch('/api/users').then(r => r.json()).then(d => {
      if (d.max_seats) setMaxSeats(d.max_seats)
    })
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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function resetForm() {
    setFormName(''); setFormEmail(''); setFormPassword(''); setFormAreaIds([]); setCreateError(''); setShowPassword(false)
  }

  function toggleAreaId(id: string) {
    setFormAreaIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id])
  }

  async function handleCreateClick() {
    const activeSdrs = users.filter(u => u.role === 'sdr' && u.is_active).length
    if (activeSdrs >= maxSeats) {
      setShowSeatLimit(true)
      return
    }
    resetForm()
    setShowForm(true)
  }

  async function handleCreate() {
    if (!formName || !formEmail || !formPassword) { setCreateError(t('allFieldsRequired')); return }
    if (formPassword.length < 8) { setCreateError(t('passwordMinLength')); return }
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: formName,
          email: formEmail,
          password: formPassword,
          area_ids: formAreaIds,
          area_id: formAreaIds[0] ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'seat_limit_reached') {
          setShowForm(false)
          setShowSeatLimit(true)
          return
        }
        setCreateError(json.error ?? 'Failed to create user')
        return
      }

      await logAuditEvent({
        event_type: 'sdr_created',
        metadata: { name: formName, email: formEmail, area_ids: formAreaIds },
      })

      setShowForm(false)
      resetForm()
      fetchUsers()
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleActive(u: UserWithArea) {
    if (u.role === 'admin') return
    if (!u.is_active) {
      setDeactivating(true)
      await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, is_active: true }) })
      fetchUsers()
      setDeactivating(false)
      return
    }
    setConfirmUser(u)
  }

  async function confirmDeactivate() {
    if (!confirmUser) return
    setDeactivating(true)
    try {
      await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: confirmUser.id, is_active: false }),
      })
      await logAuditEvent({ event_type: 'sdr_deactivated', metadata: { name: confirmUser.full_name } })
      setConfirmUser(null)
      fetchUsers()
    } finally {
      setDeactivating(false)
    }
  }

  async function confirmUnassign() {
    if (!unassignUser) return
    setUnassigning(true)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unassignUser.id, action: 'unassign' }),
      })
      const json = await res.json()
      if (!res.ok) return
      await logAuditEvent({
        event_type: 'prospect_reassigned',
        metadata: { from_sdr: unassignUser.full_name, to_sdr: 'Unassigned', action: 'bulk_unassign', count: json.count },
      })
      setUnassignSuccess(`${json.count ?? 0} leads unassigned from ${unassignUser.full_name}`)
      setUnassignUser(null)
      setTimeout(() => setUnassignSuccess(null), 4000)
    } finally {
      setUnassigning(false)
    }
  }

  async function confirmDelete() {
    if (!deleteUser) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteUser.id }),
      })
      const json = await res.json()
      if (!res.ok) { setDeleteError(json.error ?? 'Failed to delete'); return }
      await logAuditEvent({ event_type: 'sdr_deactivated', metadata: { name: deleteUser.full_name, action: 'deleted' } })
      setDeleteUser(null)
      fetchUsers()
    } finally {
      setDeleting(false)
    }
  }

  function getExtraAreas(u: UserWithArea): Area[] {
    const extraFromUserAreas = (u.user_areas ?? []).map(ua => ua.area).filter(Boolean) as Area[]
    if (extraFromUserAreas.length > 1) return extraFromUserAreas
    return u.area ? [u.area] : []
  }

  const admins = users.filter(u => u.role === 'admin')
  const sdrs = users.filter(u => u.role === 'sdr')
  const activeSdrCount = sdrs.filter(u => u.is_active).length

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('title')}</h1>
          <div style={{ fontSize: 12, color: '#52526A', marginTop: 4 }}>
            {activeSdrCount} / {maxSeats === 999 ? '∞' : maxSeats} seats used
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchUsers} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <Button
            onClick={handleCreateClick}
            style={{
              backgroundColor: activeSdrCount >= maxSeats ? '#2A2A3A' : '#6C63FF',
              color: '#FFF', height: 34, fontSize: 13, gap: 6, display: 'flex', alignItems: 'center'
            }}
          >
            <Plus size={14} /> {t('createSDR')}
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #2A2A3A', borderRadius: 10, backgroundColor: '#13131A' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#13131A', zIndex: 1 }}>
            <tr>
              <th style={S.th}>{t('name')}</th>
              <th style={S.th}>{t('email')}</th>
              <th style={S.th}>{t('role')}</th>
              <th style={S.th}>Markets</th>
              <th style={S.th}>{t('status')}</th>
              <th style={S.th}>{t('createdAt')}</th>
              <th style={S.th}>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#52526A', padding: 40 }}>Loading...</td></tr>
            )}
            {!loading && [...admins, ...sdrs].map(u => {
              const allAreas = getExtraAreas(u)
              return (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <td style={{ ...S.td, color: '#F0F0F5', fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', backgroundColor: '#2A2A3A',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: u.role === 'admin' ? '#EC4899' : '#6C63FF', flexShrink: 0,
                      }}>
                        {u.full_name[0]?.toUpperCase()}
                      </div>
                      {u.full_name}
                    </div>
                  </td>
                  <td style={{ ...S.td, color: '#8B8BA0', fontSize: 12 }}>{u.email}</td>
                  <td style={S.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      backgroundColor: u.role === 'admin' ? '#EC489920' : '#6C63FF20',
                      color: u.role === 'admin' ? '#EC4899' : '#6C63FF',
                    }}>
                      {u.role === 'admin' ? t('admin') : t('sdr')}
                    </span>
                  </td>
                  <td style={S.td}>
                    {allAreas.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {allAreas.map(a => <AreaBadge key={a.id} area={a} size="sm" />)}
                      </div>
                    ) : (
                      <span style={{ color: '#52526A' }}>—</span>
                    )}
                  </td>
                  <td style={S.td}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: u.is_active ? '#22C55E' : '#52526A' }}>
                      {u.is_active ? t('active') : t('inactive')}
                    </span>
                  </td>
                  <td style={{ ...S.td, color: '#52526A', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                    {format(new Date(u.created_at), 'MMM d, yyyy')}
                  </td>
                  <td style={S.td}>
                    {u.role !== 'admin' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleToggleActive(u)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: '1px solid',
                            borderColor: u.is_active ? '#EF444440' : '#22C55E40',
                            backgroundColor: u.is_active ? '#EF444410' : '#22C55E10',
                            color: u.is_active ? '#EF4444' : '#22C55E',
                          }}
                        >
                          {u.is_active ? <><UserX size={12} /> {t('deactivate')}</> : <><UserCheck size={12} /> {t('reactivate')}</>}
                        </button>
                        <button
                          onClick={() => setUnassignUser(u)}
                          title="Unassign all leads"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: '1px solid #F59E0B40', backgroundColor: '#F59E0B10', color: '#F59E0B' }}
                        >
                          <UserMinus size={12} /> Unassign
                        </button>
                        <button
                          onClick={() => { setDeleteError(''); setDeleteUser(u) }}
                          title="Delete SDR"
                          style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: '1px solid #7F1D1D60', backgroundColor: '#7F1D1D20', color: '#EF4444' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Seat limit modal */}
      {showSeatLimit && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setShowSeatLimit(false) }}>
          <div style={{ ...S.modalCard, maxWidth: 380, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#F59E0B20', border: '1px solid #F59E0B40', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <ShieldAlert size={22} color="#F59E0B" />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#F59E0B', marginBottom: 10 }}>Seat Limit Reached</h2>
            <p style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.6, marginBottom: 20 }}>
              Your plan allows <strong style={{ color: '#F0F0F5' }}>{maxSeats}</strong> active SDR{maxSeats !== 1 ? 's' : ''}.
              Deactivate an existing SDR or upgrade your plan to add more.
            </p>
            <Button onClick={() => setShowSeatLimit(false)} style={{ backgroundColor: '#2A2A3A', color: '#F0F0F5', width: '100%' }}>
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Create SDR Modal */}
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
                  <input
                    style={{ ...S.input, paddingRight: 36 }}
                    type={showPassword ? 'text' : 'password'}
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#52526A', cursor: 'pointer', padding: 0 }}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={S.label}>Markets (select all that apply)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {areas.map(a => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 6, border: `1px solid ${formAreaIds.includes(a.id) ? '#6C63FF40' : '#2A2A3A'}`, backgroundColor: formAreaIds.includes(a.id) ? '#6C63FF10' : 'transparent' }}>
                      <input
                        type="checkbox"
                        checked={formAreaIds.includes(a.id)}
                        onChange={() => toggleAreaId(a.id)}
                        style={{ accentColor: '#6C63FF', width: 14, height: 14 }}
                      />
                      <AreaBadge area={a} size="sm" />
                      <span style={{ fontSize: 13, color: '#F0F0F5' }}>{a.label_en}</span>
                    </label>
                  ))}
                </div>
              </div>

              {createError && (
                <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <Button onClick={() => { setShowForm(false); resetForm() }} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={creating} style={{ flex: 1, backgroundColor: '#6C63FF', color: '#FFF' }}>
                  {creating ? t('creating') : t('createSDR')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unassign confirm modal */}
      {unassignUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setUnassignUser(null) }}>
          <div style={{ ...S.modalCard, maxWidth: 380 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#F59E0B20', border: '1px solid #F59E0B40', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserMinus size={16} color="#F59E0B" />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>Unassign leads</h2>
            </div>
            <p style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.6, marginBottom: 20 }}>
              All leads assigned to <strong style={{ color: '#F0F0F5' }}>{unassignUser.full_name}</strong> will become <strong style={{ color: '#F0F0F5' }}>unassigned</strong>. Leads are not deleted.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setUnassignUser(null)} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                {t('cancel')}
              </Button>
              <Button
                onClick={confirmUnassign}
                disabled={unassigning}
                style={{ flex: 1, backgroundColor: '#F59E0B', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
              >
                <UserMinus size={13} /> {unassigning ? 'Unassigning...' : 'Unassign'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Unassign success toast */}
      {unassignSuccess && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, backgroundColor: '#1C2A1C', border: '1px solid #22C55E40', borderRadius: 8, padding: '12px 18px', color: '#22C55E', fontSize: 13, fontWeight: 500, zIndex: 100, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span> {unassignSuccess}
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteUser && (
        <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) setDeleteUser(null) }}>
          <div style={{ ...S.modalCard, maxWidth: 380 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#EF444420', border: '1px solid #EF444440', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={16} color="#EF4444" />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#EF4444' }}>{t('delete')} SDR</h2>
            </div>
            <p style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.6, marginBottom: 8 }}>
              This will <strong style={{ color: '#F0F0F5' }}>permanently delete</strong> <strong style={{ color: '#F0F0F5' }}>{deleteUser.full_name}</strong> from the platform and Supabase Auth.
            </p>
            <p style={{ fontSize: 12, color: '#52526A', marginBottom: 20 }}>
              Their leads will become unassigned. This action cannot be undone.
            </p>

            {deleteError && (
              <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12, marginBottom: 14 }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setDeleteUser(null)} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                {t('cancel')}
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={deleting}
                style={{ flex: 1, backgroundColor: '#EF4444', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Delete SDR'}
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
            <p style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.5, marginBottom: 20 }}>
              {t('deactivateConfirm', { name: confirmUser.full_name })}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setConfirmUser(null)} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                {t('cancel')}
              </Button>
              <Button onClick={confirmDeactivate} disabled={deactivating} style={{ flex: 1, backgroundColor: '#EF4444', color: '#FFF' }}>
                {deactivating ? t('deactivating') : t('deactivate')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
