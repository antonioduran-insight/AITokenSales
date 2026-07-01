'use client';

interface Props {
  temperature: "HOT" | "WARM" | "COLD" | string;
}

const CONFIG = {
  HOT:  { bg: 'rgba(248,113,113,0.1)', color: '#F87171', border: 'rgba(248,113,113,0.2)', label: '🔥 HOT' },
  WARM: { bg: 'rgba(251,191,36,0.1)',  color: '#FBBF24', border: 'rgba(251,191,36,0.2)',  label: '🌡 WARM' },
  COLD: { bg: 'rgba(96,165,250,0.1)',  color: '#60A5FA', border: 'rgba(96,165,250,0.2)',  label: '❄️ COLD' },
};

export function TemperatureBadge({ temperature }: Props) {
  const c = CONFIG[temperature as keyof typeof CONFIG] ?? CONFIG.COLD;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 6, fontSize: 11, fontWeight: 600,
      backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {c.label}
    </span>
  );
}
