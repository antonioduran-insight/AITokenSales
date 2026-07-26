import { UsersManagement } from '@/components/users/UsersManagement'
import { blockSdrAccess } from '@/lib/utils/route-guard'

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <UsersManagement />
}

