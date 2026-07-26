import { blockSdrAccess } from '@/lib/utils/route-guard'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <DashboardClient />
}
