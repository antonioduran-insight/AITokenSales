'use client'

import { useState } from 'react'

const ACCENT = '#6C63FF'
const BG = '#0A0A0F'
const SURFACE = '#13131A'
const SURFACE_RAISED = '#1C1C27'
const BORDER = '#2A2A3A'
const TEXT_MUTED = '#52526A'
const TEXT_SECONDARY = '#8B8BA0'
const SUCCESS = '#22C55E'

const S: Record<string, React.CSSProperties> = {
  page: {
    backgroundColor: BG,
    color: '#F0F0F5',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    minHeight: '100vh',
    overflowX: 'hidden',
  },
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backgroundColor: `${BG}EE`,
    backdropFilter: 'blur(12px)',
    borderBottom: `1px solid ${BORDER}`,
    padding: '0 40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
  },
  logo: {
    fontSize: 20,
    fontWeight: 800,
    background: `linear-gradient(135deg, ${ACCENT}, #A78BFA)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.5px',
  },
  navLinks: {
    display: 'flex',
    gap: 32,
    alignItems: 'center',
  },
  navLink: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  btnPrimary: {
    backgroundColor: ACCENT,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 22px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    color: TEXT_SECONDARY,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    padding: '10px 22px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  },
  section: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '80px 40px',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${ACCENT}18`,
    color: '#A78BFA',
    border: `1px solid ${ACCENT}44`,
    borderRadius: 20,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: 20,
  },
  h1: {
    fontSize: 'clamp(40px, 6vw, 72px)',
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '-2px',
    margin: '0 0 24px',
  },
  featureCard: {
    backgroundColor: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding: '28px 24px',
    transition: 'border-color 0.2s, transform 0.2s',
  },
  pricingCard: {
    backgroundColor: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: '32px 28px',
    flex: 1,
    minWidth: 220,
  },
  pricingCardHighlight: {
    backgroundColor: `${ACCENT}10`,
    border: `2px solid ${ACCENT}`,
    borderRadius: 16,
    padding: '32px 28px',
    flex: 1,
    minWidth: 220,
    position: 'relative',
  },
}

const features = [
  {
    icon: '📋',
    title: 'Kanban Pipeline',
    desc: 'Drag-and-drop cards through every outreach stage. Custom columns, colors, and stage names per organization.',
  },
  {
    icon: '🤖',
    title: 'LinkedIn Scraper',
    desc: 'AI-powered scraping pipeline — select audience combos, launch a run, and get ICP-scored leads with generated outreach messages ready to copy.',
  },
  {
    icon: '🌏',
    title: 'Multi-Region SDRs',
    desc: 'Assign reps to specific markets (Taiwan, LATAM, Vietnam, Europe). Each SDR sees only their area — full DB-level isolation.',
  },
  {
    icon: '📊',
    title: 'Analytics Dashboard',
    desc: 'Conversion rates by SDR and by region, temperature breakdowns, weekly velocity. Benchmarkable data for every team member.',
  },
  {
    icon: '💬',
    title: 'Conversation Logging',
    desc: 'Upload and archive every closed-deal chat. Search, filter, and replay conversations across your entire closed-deals history.',
  },
  {
    icon: '🛡️',
    title: 'Enterprise Security',
    desc: 'Supabase RLS policies enforce data isolation at the database layer. Service-role key never leaves the server. Full audit trail.',
  },
  {
    icon: '📥',
    title: 'CSV Import Wizard',
    desc: '5-step import: upload → area → column mapping → duplicate detection → results. Handles LinkedIn exports out of the box.',
  },
  {
    icon: '🏢',
    title: 'Global Admin Plane',
    desc: 'Manage every client org from a single control plane. Edit plans, toggle addons, view support tickets, read-only impersonation mode.',
  },
]

const steps = [
  { n: '01', title: 'Scrape LinkedIn', desc: 'Launch a scraper run against your target audience. AI scores each lead and drafts personalized outreach messages.' },
  { n: '02', title: 'Import to CRM', desc: 'One-click import from scraper → CRM. Dedup check runs automatically. Leads land in the right SDR\'s queue.' },
  { n: '03', title: 'Work the Pipeline', desc: 'SDRs drag cards through the kanban as they progress. Every status change is logged in the immutable audit trail.' },
  { n: '04', title: 'Close & Log', desc: 'Mark a deal closed, upload the conversation log. Your team\'s entire conversion history is searchable and analyzable.' },
]

const plans = [
  { name: 'Basic', price: '$550', seats: '3 seats', leads: '1,000 leads/mo', color: '#3B82F6', highlight: false, features: ['Kanban pipeline', 'CSV import', 'Scraper access', 'Audit log'] },
  { name: 'Premium', price: '$2,300', seats: '10 seats', leads: '3,000 leads/mo', color: ACCENT, highlight: true, features: ['Everything in Basic', 'Analytics dashboard', 'Multi-region SDRs', 'Support tickets'] },
  { name: 'Enterprise', price: 'Custom', seats: '15 seats', leads: '10,000 leads/mo', color: '#F59E0B', highlight: false, features: ['Everything in Premium', 'Custom pipeline stages', 'Account management', 'Priority support'] },
  { name: 'Ultra', price: 'Internal', seats: 'Unlimited', leads: 'Unlimited', color: '#EF4444', highlight: false, features: ['Unlimited everything', 'All add-ons included', 'SSO integration', 'Dedicated infra'] },
]

export default function LandingPage() {
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <div style={S.page}>
      {/* Nav */}
      <nav style={S.nav}>
        <div style={S.logo}>AITokenKing</div>
        <div style={S.navLinks}>
          <a href="#features" style={S.navLink}>Features</a>
          <a href="#how" style={S.navLink}>How it works</a>
          <a href="#pricing" style={S.navLink}>Pricing</a>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href="/en/login" style={S.btnSecondary}>Log in</a>
          <a href="/en/login" style={S.btnPrimary}>Get started</a>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ ...S.section, paddingBottom: 40, textAlign: 'center' }}>
        <div style={S.chip}>⚡ B2B LinkedIn Outreach Platform</div>
        <h1 style={S.h1}>
          Close more deals with{' '}
          <span style={{ background: `linear-gradient(135deg, ${ACCENT}, #A78BFA)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AI-powered
          </span>
          <br />LinkedIn outreach
        </h1>
        <p style={{ fontSize: 20, color: TEXT_SECONDARY, maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.6 }}>
          From prospect scraping to closed deal — one platform for your entire outreach team. Built for multi-region sales teams that need real data isolation and accountability.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/en/login" style={{ ...S.btnPrimary, padding: '14px 32px', fontSize: 16, borderRadius: 10, boxShadow: `0 4px 24px ${ACCENT}40` }}>
            Start free trial
          </a>
          <button style={{ ...S.btnSecondary, padding: '14px 32px', fontSize: 16, borderRadius: 10 }}>
            Watch demo ▶
          </button>
        </div>

        {/* Social proof */}
        <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center', gap: 40, flexWrap: 'wrap' }}>
          {[['10K+', 'Leads managed'], ['97%', 'Import accuracy'], ['4 markets', 'Taiwan · LATAM · VN · EU'], ['< 2min', 'Avg time to import']].map(([stat, label]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#F0F0F5' }}>{stat}</div>
              <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* App preview mockup */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 40px 80px' }}>
        <div style={{
          backgroundColor: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: `0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px ${BORDER}`,
        }}>
          {/* Fake browser bar */}
          <div style={{ backgroundColor: SURFACE_RAISED, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#EF4444' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#F59E0B' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: SUCCESS }} />
            <div style={{ flex: 1, backgroundColor: BG, borderRadius: 6, padding: '4px 12px', fontSize: 12, color: TEXT_MUTED, marginLeft: 8 }}>
              app.aitokenking.com/kanban
            </div>
          </div>
          {/* Fake kanban */}
          <div style={{ padding: 24, display: 'flex', gap: 14, overflowX: 'auto' }}>
            {[
              { stage: 'New', color: '#3B82F6', cards: ['Sarah Chen — Acme Corp', 'James Liu — TechVentures', 'Ana García — DataFlow'] },
              { stage: 'Connection Sent', color: '#8B5CF6', cards: ['Wei Zhang — NovaSoft', 'Carlos Mendez — LatamAI'] },
              { stage: 'Connected', color: ACCENT, cards: ['Yuki Tanaka — CloudBase', 'Mei Lin — FinTechPro', 'Diego Ruiz — MarketAI'] },
              { stage: 'Demo Scheduled', color: '#22C55E', cards: ['Park Jimin — SeoulTech'] },
              { stage: 'Closed', color: '#F59E0B', cards: ['Raj Patel — IndiaFirst', 'Emma Wilson — EuroTech'] },
            ].map(({ stage, color, cards }) => (
              <div key={stage} style={{ minWidth: 200, flex: '0 0 200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY }}>{stage}</span>
                  <span style={{ fontSize: 11, color: TEXT_MUTED, marginLeft: 'auto' }}>{cards.length}</span>
                </div>
                {cards.map(card => (
                  <div key={card} style={{ backgroundColor: SURFACE_RAISED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#F0F0F5', marginBottom: 3 }}>{card.split(' — ')[0]}</div>
                    <div style={{ fontSize: 11, color: TEXT_MUTED }}>{card.split(' — ')[1]}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      <span style={{ fontSize: 10, backgroundColor: `${color}22`, color, borderRadius: 4, padding: '1px 6px' }}>WARM</span>
                      <span style={{ fontSize: 10, backgroundColor: `${ACCENT}22`, color: '#A78BFA', borderRadius: 4, padding: '1px 6px' }}>ICP 8</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <div id="features" style={{ ...S.section, paddingTop: 60 }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={S.chip}>Features</div>
          <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>Everything your team needs</h2>
          <p style={{ fontSize: 17, color: TEXT_SECONDARY, maxWidth: 500, margin: '0 auto' }}>From first contact to closed deal, every workflow is covered.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {features.map((f, i) => (
            <div
              key={f.title}
              style={{
                ...S.featureCard,
                borderColor: hovered === i ? ACCENT + '60' : BORDER,
                transform: hovered === i ? 'translateY(-3px)' : 'none',
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: '#F0F0F5' }}>{f.title}</div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div id="how" style={{ backgroundColor: SURFACE, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ ...S.section, paddingTop: 70, paddingBottom: 70 }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={S.chip}>How it works</div>
            <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>From zero to closed deal in 4 steps</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 32 }}>
            {steps.map((step, i) => (
              <div key={step.n} style={{ position: 'relative' }}>
                <div style={{ fontSize: 48, fontWeight: 900, color: BORDER, lineHeight: 1, marginBottom: 16, fontFamily: 'monospace' }}>{step.n}</div>
                <div style={{ position: 'absolute', top: 24, left: 0, width: 3, height: 40, backgroundColor: ACCENT, borderRadius: 2 }} />
                <div style={{ paddingLeft: 16 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#F0F0F5' }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{step.desc}</div>
                </div>
                {i < steps.length - 1 && (
                  <div style={{ position: 'absolute', top: 32, right: -16, fontSize: 20, color: TEXT_MUTED }}>→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div id="pricing" style={S.section}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={S.chip}>Pricing</div>
          <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 17, color: TEXT_SECONDARY }}>Scale as your team grows. Switch plans anytime.</p>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {plans.map(plan => (
            <div key={plan.name} style={plan.highlight ? S.pricingCardHighlight : S.pricingCard}>
              {plan.highlight && (
                <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', backgroundColor: ACCENT, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                  Most Popular
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: plan.color }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: plan.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{plan.name}</div>
              </div>
              <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: '-1px', margin: '12px 0 4px', color: '#F0F0F5' }}>
                {plan.price}
                {plan.price !== 'Custom' && plan.price !== 'Internal' && <span style={{ fontSize: 16, fontWeight: 400, color: TEXT_SECONDARY }}>/mo</span>}
              </div>
              <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 24 }}>{plan.seats} · {plan.leads}</div>
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: SUCCESS, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.4 }}>{f}</span>
                  </div>
                ))}
              </div>
              <a href="/en/login" style={{
                display: 'block',
                marginTop: 28,
                textAlign: 'center',
                padding: '11px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                backgroundColor: plan.highlight ? ACCENT : 'transparent',
                color: plan.highlight ? '#fff' : TEXT_SECONDARY,
                border: plan.highlight ? 'none' : `1px solid ${BORDER}`,
              }}>
                {plan.price === 'Custom' || plan.price === 'Internal' ? 'Contact us' : 'Get started'}
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Banner */}
      <div style={{ background: `linear-gradient(135deg, ${ACCENT}20, #A78BFA10)`, borderTop: `1px solid ${ACCENT}30`, borderBottom: `1px solid ${ACCENT}30` }}>
        <div style={{ ...S.section, paddingTop: 70, paddingBottom: 70, textAlign: 'center' }}>
          <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>
            Ready to scale your outreach?
          </h2>
          <p style={{ fontSize: 17, color: TEXT_SECONDARY, maxWidth: 480, margin: '0 auto 36px' }}>
            Get your team set up in minutes. Import your first leads the same day.
          </p>
          <a href="/en/login" style={{ ...S.btnPrimary, padding: '16px 40px', fontSize: 16, borderRadius: 10, boxShadow: `0 4px 32px ${ACCENT}50` }}>
            Get started for free
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={S.logo}>AITokenKing</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Features', 'Pricing', 'Support', 'Login'].map(l => (
            <a key={l} href={l === 'Login' ? '/en/login' : `#${l.toLowerCase()}`} style={{ fontSize: 13, color: TEXT_MUTED, textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
        <div style={{ fontSize: 12, color: TEXT_MUTED }}>© 2025 AITokenKing. All rights reserved.</div>
      </footer>
    </div>
  )
}
