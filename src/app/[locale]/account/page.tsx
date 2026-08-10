'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'

/**
 * "My account" — where anyone changes their own password.
 *
 * A separate page rather than a Settings tab because Settings is admin-only
 * (it returns "adminOnly" for every other role), and an SDR needs this just as
 * much as an admin does. Everything here acts on the signed-in user, so there
 * is nothing to gate.
 */

const S: Record<string, React.CSSProperties> = {
  page: { padding: '28px 32px', color: 'var(--crm-text-primary)', maxWidth: 560 },
  card: {
    backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
    borderRadius: 10, padding: 24, marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: 'var(--crm-text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16,
  },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', marginBottom: 6, display: 'block' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 13.5,
    backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
    borderRadius: 7, color: 'var(--crm-text-primary)', outline: 'none',
  },
  button: {
    padding: '9px 20px', borderRadius: 7, border: 'none',
    backgroundColor: 'var(--crm-accent)', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  readonly: { fontSize: 13.5, color: 'var(--crm-text-primary)' },
}

export default function AccountPage() {
  const t = useTranslations('account')
  const tc = useTranslations('common')
  const { user } = useUser()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // True only when the password changed but revoking other devices failed —
  // a partial success that has to be visible, because the person may have
  // changed it precisely to lock someone else out.
  const [otherSessionsKept, setOtherSessionsKept] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)

    if (next.length < 8) { setError(t('tooShort')); return }
    if (next !== confirm) { setError(t('mismatch')); return }
    if (next === current) { setError(t('sameAsCurrent')); return }

    setSaving(true)
    const supabase = createClient()

    // Re-authenticate before changing anything.
    //
    // `updateUser({ password })` alone would succeed on any live session, so
    // an unattended laptop would be enough for someone to lock the real owner
    // out of their account. Verifying the current password makes the change
    // require knowledge, not just proximity.
    //
    // `signInWithPassword` on the same account also refreshes the very session
    // this page is using, so a correct password has no side effect beyond that.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: current,
    })
    if (reauthError) {
      setSaving(false)
      setError(t('wrongCurrent'))
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next })

    if (updateError) { setSaving(false); setError(updateError.message); return }

    // Kick every OTHER device off, keeping this one signed in.
    //
    // Changing a password does not revoke existing sessions by itself, so
    // without this the most important case silently fails: someone who changes
    // their password *because they think somebody else has it* would leave
    // that person logged in on their own device, with a live session that
    // outlives the password it was created with.
    //
    // `scope: 'others'` and not `'global'` on purpose — signing the person out
    // of the tab they just used would look like the change failed.
    //
    // Not awaited into the error path: the password IS already changed at this
    // point, so a revocation failure must not be reported as if nothing
    // happened. It is surfaced as a warning instead.
    const { error: revokeError } = await supabase.auth.signOut({ scope: 'others' })
    setSaving(false)

    setCurrent(''); setNext(''); setConfirm('')
    setDone(true)
    setOtherSessionsKept(!!revokeError)
  }

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>{tc('loading')}</div>
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>{t('title')}</h1>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t('profile')}</p>
        {/* Read-only on purpose. Changing your own name is harmless, but
            changing your own email or role is not, and one editable field
            here would invite the other two. Ask an admin. */}
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <span style={S.label}>{t('name')}</span>
            <span style={S.readonly}>{user.full_name}</span>
          </div>
          <div>
            <span style={S.label}>{t('email')}</span>
            <span style={S.readonly}>{user.email}</span>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t('changePassword')}</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={S.label}>{t('currentPassword')}</label>
            <input
              type="password" value={current} autoComplete="current-password"
              onChange={e => setCurrent(e.target.value)} style={S.input}
            />
          </div>
          <div>
            <label style={S.label}>{t('newPassword')}</label>
            <input
              type="password" value={next} autoComplete="new-password"
              onChange={e => setNext(e.target.value)} style={S.input}
            />
          </div>
          <div>
            <label style={S.label}>{t('confirmPassword')}</label>
            <input
              type="password" value={confirm} autoComplete="new-password"
              onChange={e => setConfirm(e.target.value)} style={S.input}
            />
          </div>

          {error && (
            <div style={{
              padding: '9px 12px', borderRadius: 7, fontSize: 12.5,
              background: '#EF444415', border: '1px solid #EF444440', color: '#EF4444',
            }}>{error}</div>
          )}
          {done && (
            <div style={{
              padding: '9px 12px', borderRadius: 7, fontSize: 12.5,
              background: '#22C55E15', border: '1px solid #22C55E40', color: '#22C55E',
            }}>{otherSessionsKept ? t('changedButSessionsKept') : t('changed')}</div>
          )}

          <div>
            <button
              type="submit"
              disabled={saving || !current || !next || !confirm}
              style={{ ...S.button, opacity: saving || !current || !next || !confirm ? 0.5 : 1 }}
            >
              {saving ? tc('saving') : t('changePassword')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
