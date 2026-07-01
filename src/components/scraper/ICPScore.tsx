'use client';

interface Props {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function ICPScore({ score, size = "md" }: Props) {
  const color = score >= 70 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#EF4444';
  const fontSize = size === 'lg' ? 28 : size === 'sm' ? 11 : 14;
  return (
    <span style={{ color, fontSize, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
      {score}
    </span>
  );
}
