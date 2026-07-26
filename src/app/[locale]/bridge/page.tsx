import { blockSdrAccess } from '@/lib/utils/route-guard'
import { BridgeClient } from './BridgeClient'

export default async function BridgePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <BridgeClient />
}
