'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { LanguageSwitcher } from './LanguageSwitcher'

import { UserProvider, type UserWithArea } from '@/contexts/UserContext'
import { Suspense, useState } from 'react'

interface Props {
  children: React.ReactNode
  initialUser: UserWithArea | null
  orgPlan: string
}

function ImpersonateBanner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()

  const impersonateOrgId = searchParams.get('impersonate_org_id')
  const impersonateOrgName = searchParams.get('impersonate_org_name')

  if (!impersonateOrgId) return null

  return (
    <div
      style={{
        backgroundColor: '#1C1410',
        borderBottom: '1px solid #F59E0B',
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 13,
        color: '#FCD34D',
        flexShrink: 0,
      }}
    >
      <span style={{ overflowWrap: 'anywhere' }}>👁 Viewing <strong>{decodeURIComponent(impersonateOrgName ?? '')}</strong> — Read Only Mode</span>
      <button
        onClick={() => router.push(`/${locale}/global-admin/organizations`)}
        style={{
          backgroundColor: '#92400E',
          color: '#FCD34D',
          border: '1px solid #F59E0B',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 12,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Exit
      </button>
    </div>
  )
}

export function AppShell({ children, initialUser, orgPlan }: Props) {
  const pathname = usePathname()
  const isLoginPage = /\/login$/.test(pathname)
  // The public landing must not inherit the CRM chrome — no sidebar, no user
  // menu, no org context. Same escape hatch /login already uses.
  const isLandingPage = /\/landing$/.test(pathname)
  const isGlobalAdminPage = pathname.includes('/global-admin')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  if (isLoginPage) return <>{children}</>
  if (isLandingPage) return <>{children}</>
  if (isGlobalAdminPage) return <>{children}</>

  return (
    <UserProvider value={{ user: initialUser, isAdmin: initialUser?.role === 'admin', orgPlan }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--crm-background)' }}>
        <Suspense fallback={null}>
          <ImpersonateBanner />
        </Suspense>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Suspense fallback={<aside className="crm-sidebar" style={{ width: 240, minWidth: 240, backgroundColor: 'var(--crm-surface)', borderRight: '1px solid var(--crm-border)' }} />}>
            <Sidebar user={initialUser} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
          </Suspense>
          {/* Tapping outside the open mobile drawer closes it */}
          <div
            className={`crm-sidebar-backdrop${mobileNavOpen ? ' crm-sidebar-open' : ''}`}
            onClick={() => setMobileNavOpen(false)}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--crm-background)', minWidth: 0 }}>
            <header
              style={{
                height: 52,
                borderBottom: '1px solid var(--crm-border)',
                backgroundColor: 'var(--crm-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '0 20px',
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setMobileNavOpen(true)}
                className="crm-mobile-menu-btn"
                style={{
                  marginRight: 'auto', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: 8, border: 'none',
                  backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer',
                }}
              >
                <Menu size={20} />
              </button>
              <LanguageSwitcher />
            </header>
            <main style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--crm-background)' }}>
              {/* `height: '100%'` is load-bearing, not cosmetic: Kanban and Leads
                  are `height: 100%` + `overflow: hidden` shells with their own
                  inner `overflow-x: auto` scroller. A percentage height only
                  resolves against a parent with a definite height — without it
                  this wrapper collapsed to content height, so those pages grew as
                  tall as their columns instead of filling the viewport, and their
                  horizontal scrollbar ended up at the bottom of that oversized box
                  (you had to scroll `<main>` all the way down to reach it) instead
                  of pinned to the bottom of the screen. Overflow stays visible, so
                  ordinary tall pages (Settings, Stats, ...) still scroll vertically
                  through `<main>` exactly as before. */}
              <div style={{ maxWidth: 1400, margin: '0 auto', width: '100%', height: '100%' }}>
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </UserProvider>
  )
}
