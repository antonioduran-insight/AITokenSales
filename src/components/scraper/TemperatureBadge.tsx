'use client';

import { useTranslations } from 'next-intl';

interface Props {
  temperature: "HOT" | "WARM" | "COLD" | string;
}

// Keyed by `temperature.*` — the same capitalized keys ProspectForm's
// temperature dropdown already translates through, just applied here too
// (this badge previously showed the raw "HOT"/"WARM"/"COLD" value
// regardless of locale, inconsistent with that dropdown).
const CONFIG = {
  HOT:  { bg: 'rgba(248,113,113,0.1)', color: '#F87171', border: 'rgba(248,113,113,0.2)', icon: '🔥', key: 'Hot' },
  WARM: { bg: 'rgba(251,191,36,0.1)',  color: '#FBBF24', border: 'rgba(251,191,36,0.2)',  icon: '🌡', key: 'Warm' },
  COLD: { bg: 'rgba(96,165,250,0.1)',  color: '#60A5FA', border: 'rgba(96,165,250,0.2)',  icon: '❄️', key: 'Cold' },
} as const;

export function TemperatureBadge({ temperature }: Props) {
  const t = useTranslations('temperature');
  const c = CONFIG[temperature as keyof typeof CONFIG] ?? CONFIG.COLD;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
      borderRadius: 6, fontSize: 11, fontWeight: 600,
      backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {c.icon} {t(c.key)}
    </span>
  );
}
