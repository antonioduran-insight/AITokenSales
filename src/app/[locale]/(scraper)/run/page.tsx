import { blockSdrAccess } from '@/lib/utils/route-guard'
import { RunClient } from './RunClient'

export default async function RunPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <RunClient />
}
