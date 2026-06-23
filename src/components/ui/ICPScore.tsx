interface Props {
  score: number | null | undefined
  size?: 'sm' | 'md'
}

export function ICPScore({ score, size = 'sm' }: Props) {
  if (score === null || score === undefined) return null

  const color = score >= 70 ? '#22C55E' : score >= 40 ? '#F59E0B' : '#EF4444'

  return (
    <span
      className="font-mono-data"
      style={{
        color,
        fontSize: size === 'sm' ? '11px' : '13px',
        fontWeight: 700,
        letterSpacing: '0.05em',
      }}
    >
      {score}
    </span>
  )
}
