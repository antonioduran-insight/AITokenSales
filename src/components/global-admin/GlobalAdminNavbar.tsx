'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect, useState } from 'react'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { Sun, Moon, LogOut } from 'lucide-react'

export function GlobalAdminNavbar() {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const { colors, theme, toggleTheme, lang, setLang, t } = useGlobalAdminTheme()
  const [ticketCount, setTicketCount] = useState(0)

  useEffect(() => {
    fetch('/api/global-admin/tickets/count')
      .then(r => r.json())
      .then(d => setTicketCount(d.count ?? 0))
      .catch(() => {})
  }, [])

  const navItems = [
    { href: '/global-admin/organizations', label: t('organizations') },
    { href: '/global-admin/revenue', label: t('revenue') },
    { href: '/global-admin/vendors', label: t('vendors') },
    { href: '/global-admin/support', label: t('support'), badge: ticketCount },
  ]

  async function handleLogout() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}/login`)
    router.refresh()
  }

  return (
    <nav style={{
      backgroundColor: colors.surface, borderBottom: `1px solid ${colors.border}`,
      display: 'flex', alignItems: 'center', padding: '0 24px', height: 56,
      gap: 8, position: 'sticky', top: 0, zIndex: 100,
      transition: 'background-color 0.2s',
    }}>
      <Link href={`/${locale}/global-admin/organizations`} style={{
        fontSize: 16, fontWeight: 700, color: colors.textPrimary,
        textDecoration: 'none', marginRight: 24, flexShrink: 0,
      }}>
        AIToken<span style={{ color: colors.accent }}>Sales</span>
        <span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 6,
          fontWeight: 400, letterSpacing: '0.05em' }}>GLOBAL ADMIN</span>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
        {navItems.map(item => {
          const fullHref = `/${locale}${item.href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          return (
            <Link key={item.href} href={fullHref} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 6, fontSize: 14, fontWeight: isActive ? 600 : 400,
              color: isActive ? colors.accent : colors.textSecondary,
              backgroundColor: isActive ? `${colors.accent}15` : 'transparent',
              textDecoration: 'none', transition: 'all 0.15s',
              borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
            }}>
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span style={{ backgroundColor: '#EF4444', color: '#fff',
                  borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden',
          border: `1px solid ${colors.border}` }}>
          {(['zh', 'en'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)} style={{
              padding: '4px 10px', fontSize: 12, fontWeight: lang === l ? 600 : 400,
              backgroundColor: lang === l ? colors.accent : 'transparent',
              color: lang === l ? '#fff' : colors.textSecondary,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {l === 'zh' ? '中文' : 'EN'}
            </button>
          ))}
        </div>

        <button onClick={toggleTheme} style={{
          background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6,
          padding: '6px 8px', cursor: 'pointer', color: colors.textSecondary,
          display: 'flex', alignItems: 'center', transition: 'all 0.15s',
        }}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <button onClick={handleLogout} style={{
          background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6,
          padding: '6px 10px', cursor: 'pointer', color: colors.textSecondary,
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
          onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
        >
          <LogOut size={14} />
          {t('logout')}
        </button>
      </div>
    </nav>
  )
}
