'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

/**
 * Self-service password reset request.
 *
 * Until this existed, a forgotten password meant asking an admin, who had no
 * way to help either — the only route was deleting and recreating the account.
 *
 * The email is composed by us and sent through Resend (src/lib/email/), in the
 * locale this page was opened in. Supabase only mints the one-time link.
 *
 * The link lands on /auth/callback, the same route invitations use; it already
 * handles `type=recovery` and forwards to /set-password.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations('forgotPassword')
  const locale = useLocale()

  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), locale }),
      })
      const json = await res.json().catch(() => ({}))

      if (res.status === 429) { setError(t('tooMany')); return }

      // Four distinct outcomes, each with its own next step. Collapsing them
      // into one "check your email" is what leaves someone who mistyped their
      // address waiting for a message that was never sent.
      if (json.reason === 'no_account')   { setError(t('noAccount')); return }
      if (json.reason === 'deactivated')  { setError(t('deactivated')); return }
      if (json.reason === 'send_failed')  { setError(t('sendFailed')); return }
      if (!res.ok)                        { setError(t('sendFailed')); return }

      setSent(true)
    } catch {
      setError(t('sendFailed'))
    } finally {
      setSending(false)
    }
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
      width: '100%', padding: '11px 20px', marginTop: 4, borderRadius: 8, border: 'none',
      backgroundColor: 'var(--crm-accent)', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    },
    back: {
      display: 'block', marginTop: 18, textAlign: 'center', fontSize: 13,
      color: 'var(--crm-text-muted)', textDecoration: 'none',
    },
  }

  if (sent) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 10px' }}>{t('sentTitle')}</h1>
          <p style={{ fontSize: 13.5, color: 'var(--crm-text-secondary)', lineHeight: 1.65, margin: 0 }}>
            {t('sentBody', { email: email.trim() })}
          </p>
          <Link href={`/${locale}/login`} style={S.back}>{t('backToLogin')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{t('title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: '0 0 22px', lineHeight: 1.55 }}>
          {t('subtitle')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={S.label}>{t('email')}</label>
            <input
              type="email" value={email} autoFocus autoComplete="email" required
              onChange={e => setEmail(e.target.value)} style={S.input}
            />
          </div>

          {error && (
            <div style={{
              padding: '9px 12px', borderRadius: 7, fontSize: 12.5,
              background: '#EF444415', border: '1px solid #EF444440', color: '#EF4444',
            }}>{error}</div>
          )}

          <button type="submit" disabled={sending} style={{ ...S.button, opacity: sending ? 0.6 : 1 }}>
            {sending ? t('sending') : t('submit')}
          </button>
        </form>

        <Link href={`/${locale}/login`} style={S.back}>{t('backToLogin')}</Link>
      </div>
    </div>
  )
}
