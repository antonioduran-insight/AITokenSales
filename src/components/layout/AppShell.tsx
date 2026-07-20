'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Sidebar } from './Sidebar'
import { LanguageSwitcher } from './LanguageSwitcher'

import { UserProvider, type UserWithArea } from '@/contexts/UserContext'
import { Suspense } from 'react'

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
        fontSize: 13,
        color: '#FCD34D',
        flexShrink: 0,
      }}
    >
      <span>👁 Viewing <strong>{decodeURIComponent(impersonateOrgName ?? '')}</strong> — Read Only Mode</span>
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
  const isGlobalAdminPage = pathname.includes('/global-admin')

  if (isLoginPage) return <>{children}</>
  if (isGlobalAdminPage) return <>{children}</>

  return (
    <UserProvider value={{ user: initialUser, isAdmin: initialUser?.role === 'admin', orgPlan }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--crm-background)' }}>
        <Suspense fallback={null}>
          <ImpersonateBanner />
        </Suspense>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={<aside style={{ width: 240, minWidth: 240, backgroundColor: 'var(--crm-surface)', borderRight: '1px solid var(--crm-border)' }} />}>
            <Sidebar user={initialUser} />
          </Suspense>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--crm-background)' }}>
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
              <LanguageSwitcher />
            </header>
            <main style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--crm-background)' }}>
              <div style={{ maxWidth: 1400, margin: '0 auto', width: '100%' }}>
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </UserProvider>
  )
}
