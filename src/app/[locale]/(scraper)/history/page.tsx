import { blockSdrAccess } from '@/lib/utils/route-guard'
import { HistoryClient } from './HistoryClient'

export default async function HistoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <HistoryClient />
}
