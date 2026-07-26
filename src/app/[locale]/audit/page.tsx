import { AuditLogTable } from '@/components/audit/AuditLogTable'
import { blockSdrAccess } from '@/lib/utils/route-guard'

export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  await blockSdrAccess(locale)
  return <AuditLogTable />
}

