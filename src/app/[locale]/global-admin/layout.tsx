import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GlobalAdminNavbar } from '@/components/global-admin/GlobalAdminNavbar'
import { GlobalAdminThemeProvider } from '@/contexts/GlobalAdminThemeContext'

export default async function GlobalAdminLayout({ children, params }: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const { data: userData } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (userData?.role !== 'admin_global') redirect(`/${locale}/kanban`)

  return (
    <GlobalAdminThemeProvider>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <GlobalAdminNavbar />
        <main style={{ flex: 1, padding: 24 }}>
          {children}
        </main>
      </div>
    </GlobalAdminThemeProvider>
  )
}
