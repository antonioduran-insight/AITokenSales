'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'

async function getRoleRedirect(locale: string): Promise<string> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return `/${locale}/login`

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role
  if (role === 'admin_global') return `/${locale}/global-admin/organizations`
  if (role === 'support') return `/${locale}/global-admin/support`
  return `/${locale}/kanban`
}

export default function LoginPage() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Redirect if already authenticated
  useEffect(() => {
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const dest = await getRoleRedirect(locale)
        router.replace(dest)
      }
    })
  }, [locale, router])

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

    const dest = await getRoleRedirect(locale)
    router.push(dest)
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
