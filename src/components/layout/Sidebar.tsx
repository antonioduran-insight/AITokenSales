'use client'

import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  LayoutGrid, Users2, UploadCloud, ClipboardList, BarChart3, Users, LogOut, MessageSquare,
} from 'lucide-react'
import { AreaBadge } from '@/components/ui/AreaBadge'
import type { UserWithArea } from '@/contexts/UserContext'

interface Props {
  user: UserWithArea | null
}

export function Sidebar({ user }: Props) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  const isAdmin = user?.role === 'admin'

  const navItems = [
    { href: '/kanban', label: t('kanban'), icon: LayoutGrid, always: true },
    { href: '/prospects', label: t('prospects'), icon: Users2, always: true },
    { href: '/import', label: t('import'), icon: UploadCloud, always: true },
    { href: '/conversations', label: 'Conversations', icon: MessageSquare, always: true },
    { href: '/audit', label: t('audit'), icon: ClipboardList, adminOnly: true },
    { href: '/stats', label: t('stats'), icon: BarChart3, adminOnly: true },
    { href: '/admin/users', label: t('users'), icon: Users, adminOnly: true },
  ]

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}/login`)
    router.refresh()
  }

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        backgroundColor: '#13131A',
        borderRight: '1px solid #2A2A3A',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #2A2A3A' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F5' }}>
          AIToken<span style={{ color: '#6C63FF' }}>Sales</span>
        </div>
        <div style={{ fontSize: 11, color: '#52526A', marginTop: 2 }}>CRM B2B Outreach</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        {navItems.map(item => {
          if (item.adminOnly && !isAdmin) return null
          const fullHref = `/${locale}${item.href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href as '/kanban'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                marginBottom: 2,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#F0F0F5' : '#8B8BA0',
                backgroundColor: isActive ? '#2A2A3A' : 'transparent',
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2A2A3A' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%',
                backgroundColor: '#2A2A3A',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, color: '#6C63FF', flexShrink: 0,
              }}
            >
              {user.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.full_name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase' }}>
                  {user.role}
                </span>
                {user.area && <AreaBadge area={user.area} size="sm" />}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '7px 10px',
            borderRadius: 6, border: 'none', cursor: 'pointer',
            backgroundColor: 'transparent',
            color: '#52526A', fontSize: 13,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
          onMouseLeave={e => (e.currentTarget.style.color = '#52526A')}
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </aside>
  )
}
