'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { LanguageSwitcher } from './LanguageSwitcher'
import { UserProvider, type UserWithArea } from '@/contexts/UserContext'

interface Props {
  children: React.ReactNode
  initialUser: UserWithArea | null
}

export function AppShell({ children, initialUser }: Props) {
  const pathname = usePathname()
  const isLoginPage = /\/login$/.test(pathname)

  if (isLoginPage) {
    return <>{children}</>
  }

  return (
    <UserProvider value={{ user: initialUser, isAdmin: initialUser?.role === 'admin' }}>
      <div
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          backgroundColor: '#0A0A0F',
        }}
      >
        <Sidebar user={initialUser} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
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

          {/* Main content */}
          <main
            style={{
              flex: 1,
              overflow: 'auto',
              backgroundColor: '#0A0A0F',
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </UserProvider>
  )
}
