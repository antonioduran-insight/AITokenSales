'use client'

interface AddonFeatureProps {
  children: React.ReactNode
  hasAccess: boolean
  featureName: string
}

// Same blur-plus-CTA visual pattern as PremiumFeature, for add-ons rather
// than plan tiers: show the feature exists and is worth having, don't hide
// it or 404. Org admins can't self-serve toggle add-ons (only admin_global
// can, via Global Admin), so the CTA is "contact us" rather than a
// self-service upgrade link.
export function AddonFeature({ children, hasAccess, featureName }: AddonFeatureProps) {
  if (hasAccess) return <>{children}</>

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
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
        padding: 24,
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
          BD Group is a paid add-on — not yet enabled for your organization.
        </p>
        <a
          href="mailto:placeholder@aitokenking.com?subject=Enable+BD+Group"
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
          Contact Us
        </a>
      </div>
    </div>
  )
}
