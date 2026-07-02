import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GlobalAdminSidebar } from '@/components/global-admin/GlobalAdminSidebar'

export default async function GlobalAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login`)
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin_global') {
    redirect(`/${locale}/kanban`)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#0A0A0F' }}>
      <GlobalAdminSidebar />
      <main style={{ flex: 1, overflow: 'auto', backgroundColor: '#0A0A0F' }}>
        {children}
      </main>
    </div>
  )
}
