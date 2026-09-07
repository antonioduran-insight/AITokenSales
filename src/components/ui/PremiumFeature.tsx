'use client'

import { useLocale } from 'next-intl'
import { planHasFullAccess } from '@/lib/types'

interface PremiumFeatureProps {
  children: React.ReactNode
  plan: string
  requiredPlan: 'premium' | 'enterprise'
  featureName: string
}

export function PremiumFeature({ children, plan, requiredPlan, featureName }: PremiumFeatureProps) {
  const locale = useLocale()

  const hasAccess =
    !plan ||                       // admin_global / no org
    planHasFullAccess(plan) ||     // ultra (internal) and demo (a trial shows everything)
    plan === 'enterprise' ||
    (requiredPlan === 'premium' && plan === 'premium')

  if (hasAccess) return <>{children}</>

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
      {/* Content blurred — blur is inline so DevTools cannot remove the overlay without
          also removing the blur from the parent */}
      <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none' }}>
        {children}
      </div>

      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 10, 26, 0.75)',
        backdropFilter: 'blur(2px)',
        borderRadius: 8,
        gap: 12,
      }}>
        <div style={{ fontSize: 28 }}>🔒</div>
        <p style={{
          color: 'var(--crm-text-primary)',
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
          padding: '0 24px',
          margin: 0,
        }}>
          {featureName}
        </p>
        <p style={{ color: 'var(--crm-text-secondary)', fontSize: 12, textAlign: 'center', margin: 0 }}>
          Available from {requiredPlan === 'premium' ? 'Premium' : 'Enterprise'} plan
        </p>
        <a
          href={`/${locale}/settings?tab=plan`}
          style={{
            background: 'var(--crm-accent)',
            color: 'white',
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Upgrade Plan
        </a>
      </div>
    </div>
  )
}
