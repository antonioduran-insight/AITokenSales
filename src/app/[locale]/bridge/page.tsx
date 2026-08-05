import { blockSdrAccess, requireAddon } from '@/lib/utils/route-guard'
import { BridgeClient } from './BridgeClient'

export default async function BridgePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  // Two separate gates: role first, then entitlement. The sidebar already
  // hides this link without the add-on, but hiding a link is not a guard —
  // the URL is still typeable, and before this an admin without Bridge got
  // the full page with every request inside it 403-ing.
  await blockSdrAccess(locale)
  await requireAddon(locale, 'bridge')
  return <BridgeClient />
}
