import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/AppShell'
import type { UserWithArea } from '@/contexts/UserContext'

const locales = ['zh', 'en', 'vi', 'es']

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!locales.includes(locale)) notFound()

  const messages = await getMessages()

  let userProfile: UserWithArea | null = null
  let orgPlan = ''
  try {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (authUser) {
      const { data } = await supabase
        .from('users')
        .select('*, area:areas(*)')
        .eq('id', authUser.id)
        .maybeSingle()
      userProfile = data as UserWithArea | null

      if (userProfile?.role === 'admin_global') {
        orgPlan = 'ultra'
      } else if (userProfile?.organization_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('plan')
          .eq('id', userProfile.organization_id)
          .single()
        orgPlan = orgData?.plan ?? 'basic'
      }
    }
  } catch (e) {
    console.log('[layout] catch error:', e)
  }

  return (
    <NextIntlClientProvider messages={messages}>
      <AppShell initialUser={userProfile} orgPlan={orgPlan}>{children}</AppShell>
    </NextIntlClientProvider>
  )
}
