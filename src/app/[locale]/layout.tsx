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

  // Fetch user profile server-side — no RLS issues, available immediately
  let userProfile: UserWithArea | null = null
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
    }
  } catch {
    // Not authenticated — AppShell handles the login redirect
  }

  return (
    <NextIntlClientProvider messages={messages}>
      <AppShell initialUser={userProfile}>{children}</AppShell>
    </NextIntlClientProvider>
  )
}
