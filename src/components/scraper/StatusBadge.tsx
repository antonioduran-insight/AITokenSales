'use client';

import { useTranslations } from 'next-intl';
import type { RunStatus } from "@/lib/types";

const STATUS_COLORS: Record<RunStatus, string> = {
  pending:   { bg: 'var(--crm-border)', color: 'var(--crm-text-secondary)', border: '#3A3A4A' } as unknown as string,
  running:   { bg: '#6C63FF20', color: 'var(--crm-accent)', border: '#6C63FF40' } as unknown as string,
  scoring:   { bg: '#F59E0B20', color: '#F59E0B', border: '#F59E0B40' } as unknown as string,
  drafting:  { bg: '#22C55E20', color: '#22C55E', border: '#22C55E40' } as unknown as string,
  completed: { bg: '#22C55E20', color: '#22C55E', border: '#22C55E40' } as unknown as string,
  failed:    { bg: '#EF444420', color: '#EF4444', border: '#EF444440' } as unknown as string,
  cancelled: { bg: '#52526A20', color: 'var(--crm-text-muted)', border: '#52526A40' } as unknown as string,
};

const PULSE_STATUSES = new Set<RunStatus>(["running", "scoring", "drafting"]);

interface Props {
  status: RunStatus;
}

export function StatusBadge({ status }: Props) {
  const t = useTranslations('runStatus');
  // RunStatus is a closed union and every value has a runStatus.* key, so
  // this always resolves — no fallback needed.
  const label = t(status);
  const pulse = PULSE_STATUSES.has(status);
  const c = STATUS_COLORS[status] as unknown as { bg: string; color: string; border: string };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {pulse && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          backgroundColor: 'currentColor',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      )}
      {label}
    </span>
  );
}
