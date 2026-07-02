'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Building2, TrendingUp, Headphones, Users, LogOut } from 'lucide-react'

export function GlobalAdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const [ticketCount, setTicketCount] = useState<number>(0)

  useEffect(() => {
    fetch('/api/global-admin/tickets/count')
      .then(r => r.json())
      .then(d => setTicketCount(d.count ?? 0))
      .catch(() => {})
  }, [])

  const navItems = [
    { href: '/global-admin/organizations', label: 'Organizations', icon: Building2 },
    { href: '/global-admin/revenue', label: 'Revenue', icon: TrendingUp },
    { href: '/global-admin/support', label: 'Support', icon: Headphones, badge: ticketCount },
    { href: '/global-admin/vendors', label: 'Vendors', icon: Users },
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
        <div style={{ fontSize: 11, color: '#52526A', marginTop: 2 }}>Global Admin</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const fullHref = `/${locale}${item.href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          const Icon = item.icon

          return (
            <a
              key={item.href}
              href={fullHref}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                marginBottom: 2,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#A78BFA' : '#8B8BA0',
                backgroundColor: isActive ? '#6C63FF15' : 'transparent',
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span
                  style={{
                    backgroundColor: '#EF4444',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '1px 6px',
                    fontSize: 11,
                    fontWeight: 700,
                    minWidth: 18,
                    textAlign: 'center',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </a>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2A2A3A' }}>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 10px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: 'transparent',
            color: '#52526A',
            fontSize: 13,
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
