'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'

type LoginOutcome =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: 'user_inactive' | 'org_inactive' }

// Supabase Auth's own session validity (a valid JWT) says nothing about
// whether the app has deactivated this user or their organization — that's
// tracked separately in public.users.is_active / public.organizations.is_active
// and was never checked anywhere (QA-F1). A deactivated account/org still has
// a perfectly valid Supabase session, so this must explicitly sign them back
// out — otherwise they'd just keep bouncing between login and their
// destination page on every visit.
async function resolveLoginOutcome(locale: string): Promise<LoginOutcome | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, is_active, organizations(is_active)')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut()
    return { ok: false, reason: 'user_inactive' }
  }

  // Supabase types this embedded relation as an array regardless of the
  // FK's actual to-one cardinality — a user belongs to at most one org.
  const orgs = profile.organizations as unknown as { is_active: boolean }[] | null
  if (orgs && orgs.length > 0 && !orgs[0].is_active) {
    await supabase.auth.signOut()
    return { ok: false, reason: 'org_inactive' }
  }

  const role = profile.role
  if (role === 'admin_global') return { ok: true, redirectTo: `/${locale}/global-admin/organizations` }
  if (role === 'support') return { ok: true, redirectTo: `/${locale}/global-admin/support` }
  return { ok: true, redirectTo: `/${locale}/kanban` }
}

function LoginContent() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Arrived here via middleware kicking out a session that was deactivated
  // mid-session (QA-F1) — the session's already been cleared server-side by
  // that point, so there's no session left to re-check; just show why. Read
  // synchronously from the initial state rather than an effect, since
  // useSearchParams() is already available at render time.
  const [error, setError] = useState<string | null>(() => {
    const deactivated = searchParams.get('deactivated')
    if (deactivated === 'org') return t('orgDeactivated')
    if (deactivated === 'user') return t('accountDeactivated')
    return null
  })
  const [loading, setLoading] = useState(false)

  // Redirect if already authenticated
  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const outcome = await resolveLoginOutcome(locale)
      if (!outcome) return
      if (outcome.ok) { router.replace(outcome.redirectTo); return }
      setError(outcome.reason === 'org_inactive' ? t('orgDeactivated') : t('accountDeactivated'))
    })
  }, [locale, router, t])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(t('loginError'))
      setLoading(false)
      return
    }

    const outcome = await resolveLoginOutcome(locale)
    if (!outcome || !outcome.ok) {
      setError(outcome?.reason === 'org_inactive' ? t('orgDeactivated') : t('accountDeactivated'))
      setLoading(false)
      return
    }

    router.push(outcome.redirectTo)
    router.refresh()
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0A0A0F',
        position: 'relative',
      }}
    >
      {/* Language switcher top-right */}
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <LanguageSwitcher />
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 360,
          padding: '36px 32px',
          backgroundColor: '#13131A',
          border: '1px solid #2A2A3A',
          borderRadius: 12,
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F5' }}>
            AIToken<span style={{ color: '#6C63FF' }}>Sales</span>
          </div>
          <div style={{ fontSize: 12, color: '#52526A', marginTop: 4 }}>
            CRM B2B Outreach
          </div>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Label style={{ color: '#8B8BA0', fontSize: 12, marginBottom: 6, display: 'block' }}>
              {t('email')}
            </Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5' }}
            />
          </div>

          <div>
            <Label style={{ color: '#8B8BA0', fontSize: 12, marginBottom: 6, display: 'block' }}>
              {t('password')}
            </Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5' }}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px',
              backgroundColor: '#3A1A1A',
              border: '1px solid #EF4444',
              borderRadius: 6,
              color: '#F87171',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: loading ? '#5A52E0' : '#6C63FF',
              color: '#F0F0F5',
              marginTop: 4,
              width: '100%',
              height: 40,
            }}
          >
            {loading ? t('signingIn') : t('loginButton')}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
