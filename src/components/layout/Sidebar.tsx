'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutGrid, Users2, ClipboardList, BarChart3, Users, LogOut, Trophy,
  LayoutDashboard, Play, History, MessageSquare, Settings2,
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
  const searchParams = useSearchParams()

  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed')
    if (saved !== null) setCollapsed(saved === 'true')
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  const isAdmin = user?.role === 'admin'
  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const impersonateOrgName = searchParams.get('impersonate_org_name')
  const isImpersonating = !!impersonateOrgId

  const queryStr = impersonateOrgId
    ? `?impersonate_org_id=${impersonateOrgId}&impersonate_org_name=${encodeURIComponent(impersonateOrgName ?? '')}`
    : ''

  const showAdmin = isAdmin || isImpersonating

  const navItems = [
    { href: '/kanban', label: t('kanban'), icon: LayoutGrid, always: true },
    { href: '/prospects', label: t('prospects'), icon: Users2, always: true },
    { href: '/convertidos', label: t('convertidos'), icon: Trophy, always: true },
    { href: '/audit', label: t('audit'), icon: ClipboardList, adminOnly: true },
    { href: '/stats', label: t('stats'), icon: BarChart3, adminOnly: true },
    { href: '/admin/users', label: t('users'), icon: Users, adminOnly: true },
    { href: '/conversations', label: 'Conversations', icon: MessageSquare, adminOnly: true },
    { href: '/settings', label: 'Settings', icon: Settings2, adminOnly: true },
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
        width: collapsed ? 64 : 240,
        minWidth: collapsed ? 64 : 240,
        backgroundColor: '#13131A',
        borderRight: '1px solid #2A2A3A',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={toggleCollapsed}
        style={{
          position: 'absolute',
          right: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 24, height: 24,
          borderRadius: '50%',
          backgroundColor: '#2A2A3A',
          border: '1px solid #3A3A4A',
          color: '#8B8BA0',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Logo */}
      <div style={{ padding: collapsed ? '20px 0 16px' : '20px 20px 16px', borderBottom: '1px solid #2A2A3A', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', overflow: 'hidden' }}>
        {collapsed ? (
          <span style={{ fontSize: 20, fontWeight: 700, color: '#6C63FF' }}>A</span>
        ) : (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F0F0F5' }}>
              AIToken<span style={{ color: '#6C63FF' }}>Sales</span>
            </div>
            <div style={{ fontSize: 11, color: '#52526A', marginTop: 2 }}>CRM B2B Outreach</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: collapsed ? '12px 4px' : '12px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
        {navItems.map(item => {
          if (item.adminOnly && !showAdmin) return null
          const fullHref = `/${locale}${item.href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          const Icon = item.icon
          const linkHref = `/${locale}${item.href}${queryStr}`

          return (
            <a
              key={item.href}
              href={linkHref}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 10,
                padding: collapsed ? '10px 0' : '9px 12px',
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
              {!collapsed && item.label}
            </a>
          )
        })}

        {/* Scraper section */}
        {(isAdmin || user?.role === 'sdr') && !isImpersonating && (
          <>
            <div style={{ margin: '10px 4px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {!collapsed && <div style={{ flex: 1, height: 1, backgroundColor: '#2A2A3A' }} />}
              {!collapsed && <span style={{ fontSize: 10, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Scraper</span>}
              {!collapsed && <div style={{ flex: 1, height: 1, backgroundColor: '#2A2A3A' }} />}
              {collapsed && <div style={{ width: '100%', height: 1, backgroundColor: '#2A2A3A' }} />}
            </div>
            {[
              { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { href: '/run',       label: 'New Run',   icon: Play },
              { href: '/history',   label: 'History',   icon: History },
              { href: '/leads',     label: 'Leads',     icon: Users2 },
            ].map(item => {
              const fullHref = `/${locale}${item.href}`
              const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
              const Icon = item.icon
              return (
                <a
                  key={item.href}
                  href={`/${locale}${item.href}`}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10,
                    padding: collapsed ? '10px 0' : '8px 12px', borderRadius: 8, marginBottom: 2,
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#A78BFA' : '#52526A',
                    backgroundColor: isActive ? '#6C63FF15' : 'transparent',
                    textDecoration: 'none', transition: 'all 0.15s',
                  }}
                >
                  <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                  {!collapsed && item.label}
                </a>
              )
            })}
          </>
        )}
      </nav>

      {/* User footer */}
      <div style={{ padding: collapsed ? '12px 0' : '12px 16px', borderTop: '1px solid #2A2A3A', display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10, marginBottom: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
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
            {!collapsed && (
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
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 8,
            width: '100%', padding: collapsed ? '7px 0' : '7px 10px',
            borderRadius: 6, border: 'none', cursor: 'pointer',
            backgroundColor: 'transparent',
            color: '#52526A', fontSize: 13,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
          onMouseLeave={e => (e.currentTarget.style.color = '#52526A')}
        >
          <LogOut size={14} />
          {!collapsed && 'Logout'}
        </button>
      </div>
    </aside>
  )
}
