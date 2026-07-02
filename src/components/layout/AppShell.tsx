'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Sidebar } from './Sidebar'
import { LanguageSwitcher } from './LanguageSwitcher'
import { UserProvider, type UserWithArea } from '@/contexts/UserContext'
import { ImpersonateContext } from '@/contexts/ImpersonateContext'
import { useEffect, useState } from 'react'

interface Props {
  children: React.ReactNode
  initialUser: UserWithArea | null
}

interface ImpersonateOrg {
  id: string
  name: string
}

export function AppShell({ children, initialUser }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const isLoginPage = /\/login$/.test(pathname)
  const isGlobalAdminPage = pathname.includes('/global-admin')

  const [impersonateOrg, setImpersonateOrg] = useState<ImpersonateOrg | null>(null)

  useEffect(() => {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const parts = cookie.trim().split('=')
      const name = parts[0]
      const value = parts.slice(1).join('=')
      if (name === 'impersonate_org') {
        try {
          setImpersonateOrg(JSON.parse(decodeURIComponent(value)))
        } catch {
          setImpersonateOrg(null)
        }
        return
      }
    }
    setImpersonateOrg(null)
  }, [pathname])

  if (isLoginPage) return <>{children}</>
  if (isGlobalAdminPage) return <>{children}</>

  async function handleExitImpersonate() {
    await fetch('/api/global-admin/impersonate', { method: 'DELETE' })
    setImpersonateOrg(null)
    router.push(`/${locale}/global-admin/organizations`)
    router.refresh()
  }

  const impersonateValue = {
    impersonateOrgId: impersonateOrg?.id ?? null,
    impersonateOrgName: impersonateOrg?.name ?? null,
    isImpersonating: !!impersonateOrg,
  }

  return (
    <ImpersonateContext.Provider value={impersonateValue}>
      <UserProvider value={{ user: initialUser, isAdmin: initialUser?.role === 'admin' }}>
        {impersonateOrg && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 9999,
              backgroundColor: '#1C1410',
              borderBottom: '1px solid #F59E0B',
              padding: '8px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
              color: '#FCD34D',
            }}
          >
            <span>👁 Viewing <strong>{impersonateOrg.name}</strong> — Read Only Mode</span>
            <button
              onClick={handleExitImpersonate}
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
        )}
        <div
          style={{
            display: 'flex',
            height: '100vh',
            overflow: 'hidden',
            backgroundColor: '#0A0A0F',
            paddingTop: impersonateOrg ? 37 : 0,
          }}
        >
          <Sidebar user={initialUser} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <header
              style={{
                height: 52,
                borderBottom: '1px solid #2A2A3A',
                backgroundColor: '#13131A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '0 20px',
                flexShrink: 0,
              }}
            >
              <LanguageSwitcher />
            </header>
            <main style={{ flex: 1, overflow: 'auto', backgroundColor: '#0A0A0F' }}>
              {children}
            </main>
          </div>
        </div>
      </UserProvider>
    </ImpersonateContext.Provider>
  )
}
