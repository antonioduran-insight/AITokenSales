import { blockSdrAccess } from '@/lib/utils/route-guard'
import { ExportClient } from './ExportClient'

export default async function ExportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <ExportClient />
}
