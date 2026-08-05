'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

/**
 * Where an invited person chooses their own password.
 *
 * This replaces the previous onboarding, in which an admin generated a
 * temporary password, saw it once behind a "save these credentials, they
 * won't be shown again" warning, and then relayed it to the new rep over
 * whatever chat app was to hand. That password was readable by anyone who saw
 * the message, and in practice was rarely changed.
 *
 * Reached only from /auth/callback, which has already exchanged the emailed
 * token for a session — so `updateUser` below authenticates as the invitee
 * without ever having had a password to begin with.
 *
 * Public in middleware: someone arriving here mid-invitation has a session but
 * no reason to be bounced into the CRM before their account is usable.
 */
export default function SetPasswordPage() {
  const t = useTranslations('setPassword')
  const locale = useLocale()
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
      setChecking(false)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Mirrors the rule the admin-side create form already enforces, so the two
    // ways into an account can't end up with different minimum strengths.
    if (password.length < 8) { setError(t('tooShort')); return }
    if (password !== confirm) { setError(t('mismatch')); return }

    setSaving(true)
    const { error: err } = await createClient().auth.updateUser({ password })
    if (err) { setError(err.message); setSaving(false); return }

    // Straight into the app. The session from the invite link is already a
    // real one, so there is nothing to log in to again.
    router.push(`/${locale}/kanban`)
    router.refresh()
  }

  const S: Record<string, React.CSSProperties> = {
    page: {
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, backgroundColor: 'var(--crm-bg)', color: 'var(--crm-text-primary)',
    },
    card: {
      width: 400, maxWidth: '100%', boxSizing: 'border-box',
      backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
      borderRadius: 12, padding: 32,
    },
    label: { fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', marginBottom: 6, display: 'block' },
    input: {
      width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14,
      backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
      borderRadius: 7, color: 'var(--crm-text-primary)', outline: 'none',
    },
    button: {
      width: '100%', padding: '11px 20px', marginTop: 6, borderRadius: 8, border: 'none',
      backgroundColor: 'var(--crm-accent)', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    },
  }

  if (checking) {
    return <div style={S.page}><span style={{ color: 'var(--crm-text-muted)' }}>…</span></div>
  }

  // No session means the link was already used, expired, or opened in a
  // different browser than the one that started the flow. Say so plainly —
  // an empty form the person can't submit is worse than a clear dead end.
  if (!email) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px' }}>{t('expiredTitle')}</h1>
          <p style={{ fontSize: 13.5, color: 'var(--crm-text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
            {t('expiredBody')}
          </p>
          <a href={`/${locale}/login`} style={{ ...S.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('backToLogin')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{t('title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: '0 0 22px' }}>
          {t('subtitle', { email })}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={S.label}>{t('newPassword')}</label>
            <input
              type="password" value={password} autoFocus autoComplete="new-password"
              onChange={e => setPassword(e.target.value)} style={S.input}
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

          <button type="submit" disabled={saving} style={{ ...S.button, opacity: saving ? 0.6 : 1 }}>
            {saving ? t('saving') : t('submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
