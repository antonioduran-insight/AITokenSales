'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutGrid, Users2, ClipboardList, BarChart3, Users, LogOut, Trophy,
  LayoutDashboard, Play, History, Headphones, Settings2, Handshake, UploadCloud, X,
} from 'lucide-react'
import { AreaBadge } from '@/components/ui/AreaBadge'
import type { UserWithArea } from '@/contexts/UserContext'

interface Props {
  user: UserWithArea | null
  /** Mobile slide-in drawer state — irrelevant at tablet/desktop widths, where the sidebar is always visible regardless of this prop. */
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({ user, mobileOpen = false, onCloseMobile }: Props) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [collapsed, setCollapsed] = useState(false)
  const [addons, setAddons] = useState<string[]>([])

  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed')
    if (saved !== null) setCollapsed(saved === 'true')
  }, [])

  // Add-on-gated sections (Bridge) only appear when the org has them active.
  useEffect(() => {
    fetch('/api/settings/addons')
      .then(r => r.json())
      .then(d => setAddons(Array.isArray(d.addons) ? d.addons : []))
      .catch(() => {})
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  // The desktop icon-only preference must never apply to the mobile drawer —
  // it has plenty of width (240px) and no reason to hide labels. Every layout
  // decision below reads this instead of the raw `collapsed` state; only the
  // toggle button itself (hidden on mobile) reflects the real preference.
  const isIconOnly = collapsed && !mobileOpen

  const isAdmin = user?.role === 'admin'
  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const impersonateOrgName = searchParams.get('impersonate_org_name')
  const isImpersonating = !!impersonateOrgId

  const queryStr = impersonateOrgId
    ? `?impersonate_org_id=${impersonateOrgId}&impersonate_org_name=${encodeURIComponent(impersonateOrgName ?? '')}`
    : ''

  const showAdmin = isAdmin || isImpersonating
  const isSupport = user?.role === 'support'

  // Support is org-independent internal staff confined to the ticket queue
  // (middleware enforces this server-side too) — every other link here
  // would just redirect straight back, so don't show them at all.
  const navItems = isSupport
    ? [{ href: '/support', label: 'Support', icon: Headphones, always: true }]
    : [
        { href: '/kanban', label: t('kanban'), icon: LayoutGrid, always: true },
        { href: '/prospects', label: t('prospects'), icon: Users2, always: true },
        { href: '/import', label: 'Import', icon: UploadCloud, always: true, hideWhenImpersonating: true },
        { href: '/convertidos', label: t('convertidos'), icon: Trophy, always: true },
        { href: '/support', label: 'Support', icon: Headphones, always: true },
        { href: '/audit', label: t('audit'), icon: ClipboardList, adminOnly: true },
        { href: '/stats', label: t('stats'), icon: BarChart3, adminOnly: true },
        { href: '/admin/users', label: t('users'), icon: Users, adminOnly: true },
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
      className={`crm-sidebar${mobileOpen ? ' crm-sidebar-open' : ''}`}
      style={{
        width: isIconOnly ? 64 : 240,
        minWidth: isIconOnly ? 64 : 240,
        backgroundColor: 'var(--crm-surface)',
        borderRight: '1px solid var(--crm-border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* Toggle button — desktop/tablet only, mobile uses the drawer's own close button */}
      <button
        onClick={toggleCollapsed}
        className="crm-hide-mobile"
        style={{
          position: 'absolute',
          right: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 24, height: 24,
          borderRadius: '50%',
          backgroundColor: 'var(--crm-border)',
          border: '1px solid #3A3A4A',
          color: 'var(--crm-text-secondary)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Close button — mobile drawer only */}
      <button
        onClick={onCloseMobile}
        className="crm-mobile-menu-btn"
        style={{
          position: 'absolute',
          right: 12,
          top: 16,
          width: 28, height: 28,
          borderRadius: 8,
          backgroundColor: 'transparent',
          border: 'none',
          color: 'var(--crm-text-muted)',
          cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <X size={18} />
      </button>

      {/* Logo */}
      <div style={{ padding: isIconOnly ? '20px 0 16px' : '20px 20px 16px', borderBottom: '1px solid var(--crm-border)', display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', overflow: 'hidden' }}>
        {isIconOnly ? (
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--crm-accent)' }}>A</span>
        ) : (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--crm-text-primary)' }}>
              AIToken<span style={{ color: 'var(--crm-accent)' }}>Sales</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 2 }}>CRM B2B Outreach</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: isIconOnly ? '12px 4px' : '12px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
        {navItems.map(item => {
          if (item.adminOnly && !showAdmin) return null
          if ('hideWhenImpersonating' in item && item.hideWhenImpersonating && isImpersonating) return null
          const fullHref = `/${locale}${item.href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          const Icon = item.icon
          const linkHref = `/${locale}${item.href}${queryStr}`

          return (
            <Link
              key={item.href}
              href={linkHref}
              prefetch={false}
              onClick={onCloseMobile}
              title={isIconOnly ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isIconOnly ? 'center' : 'flex-start',
                gap: 10,
                padding: isIconOnly ? '10px 0' : '9px 12px',
                borderRadius: 8,
                marginBottom: 2,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)',
                backgroundColor: isActive ? 'var(--crm-border)' : 'transparent',
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
              {!isIconOnly && item.label}
            </Link>
          )
        })}

        {/* Scraper section — admin only. SDRs never have scraper access. */}
        {isAdmin && !isImpersonating && (
          <>
            <div style={{ margin: '10px 4px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {!isIconOnly && <div style={{ flex: 1, height: 1, backgroundColor: 'var(--crm-border)' }} />}
              {!isIconOnly && <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Scraper</span>}
              {!isIconOnly && <div style={{ flex: 1, height: 1, backgroundColor: 'var(--crm-border)' }} />}
              {isIconOnly && <div style={{ width: '100%', height: 1, backgroundColor: 'var(--crm-border)' }} />}
            </div>
            {[
              { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { href: '/run',       label: 'New Run',   icon: Play },
              { href: '/history',   label: 'History',   icon: History },
            ].map(item => {
              const fullHref = `/${locale}${item.href}`
              const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={`/${locale}${item.href}`}
                  prefetch={false}
                  onClick={onCloseMobile}
                  title={isIconOnly ? item.label : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', gap: 10,
                    padding: isIconOnly ? '10px 0' : '8px 12px', borderRadius: 8, marginBottom: 2,
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#A78BFA' : 'var(--crm-text-muted)',
                    backgroundColor: isActive ? '#6C63FF15' : 'transparent',
                    textDecoration: 'none', transition: 'all 0.15s',
                  }}
                >
                  <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                  {!isIconOnly && item.label}
                </Link>
              )
            })}
          </>
        )}

        {/* Bridge — admin only, and only when the org has the add-on active */}
        {isAdmin && !isImpersonating && addons.includes('bridge') && (() => {
          const fullHref = `/${locale}/bridge`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          return (
            <>
              <div style={{ margin: '10px 4px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {!isIconOnly && <div style={{ flex: 1, height: 1, backgroundColor: 'var(--crm-border)' }} />}
                {!isIconOnly && <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Bridge</span>}
                {!isIconOnly && <div style={{ flex: 1, height: 1, backgroundColor: 'var(--crm-border)' }} />}
                {isIconOnly && <div style={{ width: '100%', height: 1, backgroundColor: 'var(--crm-border)' }} />}
              </div>
              <Link
                href={fullHref}
                prefetch={false}
                onClick={onCloseMobile}
                title={isIconOnly ? 'Partnerships' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', gap: 10,
                  padding: isIconOnly ? '10px 0' : '8px 12px', borderRadius: 8, marginBottom: 2,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#A78BFA' : 'var(--crm-text-muted)',
                  backgroundColor: isActive ? '#6C63FF15' : 'transparent',
                  textDecoration: 'none', transition: 'all 0.15s',
                }}
              >
                <Handshake size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                {!isIconOnly && 'Partnerships'}
              </Link>
            </>
          )
        })()}
      </nav>

      {/* User footer */}
      <div style={{ padding: isIconOnly ? '12px 0' : '12px 16px', borderTop: '1px solid var(--crm-border)', display: 'flex', flexDirection: 'column', alignItems: isIconOnly ? 'center' : 'stretch' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: isIconOnly ? 0 : 10, marginBottom: 10, justifyContent: isIconOnly ? 'center' : 'flex-start' }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%',
                backgroundColor: 'var(--crm-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, color: 'var(--crm-accent)', flexShrink: 0,
              }}
            >
              {user.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            {!isIconOnly && (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.full_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase' }}>
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
          title={isIconOnly ? 'Logout' : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', gap: 8,
            width: '100%', padding: isIconOnly ? '7px 0' : '7px 10px',
            borderRadius: 6, border: 'none', cursor: 'pointer',
            backgroundColor: 'transparent',
            color: 'var(--crm-text-muted)', fontSize: 13,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--crm-text-muted)')}
        >
          <LogOut size={14} />
          {!isIconOnly && 'Logout'}
        </button>
      </div>
    </aside>
  )
}
