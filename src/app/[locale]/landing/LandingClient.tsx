'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import {
  Sun, Moon, Globe, ArrowRight, Check, Target, Languages,
  Gauge, Users2, ShieldCheck, Zap, Loader2,
  UserCog, Upload, Archive, ClipboardList, MapPin, Settings2, MonitorPlay,
} from 'lucide-react'
import { ProductDemo, type Screen } from './ProductDemo'
import './theme.css'

const LOCALES = [
  { code: 'zh', label: '繁中' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'vi', label: 'VI' },
]

const THEME_KEY = 'landing_theme'

export function LandingClient() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  // Dark first — it matches the product and is what the mockup shows. Read
  // from localStorage after mount rather than during render: the server has
  // no way to know the preference, and reading it during render would produce
  // markup that disagrees with the client and get hydration-mismatched.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  function toggleTheme() {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try { window.localStorage.setItem(THEME_KEY, next) } catch { /* private mode */ }
      return next
    })
  }

  function switchLocale(code: string) {
    // The locale is the first path segment; swap it and keep the rest.
    const rest = pathname.split('/').slice(2).join('/')
    router.push(`/${code}${rest ? `/${rest}` : ''}`)
  }

  // Which screen the embedded product demo is on. Lifted up here (rather
  // than kept as ProductDemo's own internal state) so "How it works" can
  // drive it: clicking a step jumps the live demo to the screen that step
  // is actually describing, instead of a static GIF that goes stale the
  // moment the UI changes.
  const [demoScreen, setDemoScreen] = useState<Screen>('kanban')
  function jumpToDemo(screen: Screen) {
    setDemoScreen(screen)
    document.getElementById('product')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="landing-root" data-landing-theme={theme}>
      <Nav
        t={t} locale={locale} theme={theme}
        onToggleTheme={toggleTheme} onSwitchLocale={switchLocale}
      />
      <Hero t={t} />
      <Problem t={t} />
      <DemoSection t={t} screen={demoScreen} onScreenChange={setDemoScreen} />
      <Differentiators t={t} />
      <AlsoIncluded t={t} />
      <HowItWorks t={t} onStepClick={jumpToDemo} />
      <Plans t={t} />
      <DemoForm t={t} locale={locale} />
      <Footer t={t} />
    </div>
  )
}

type T = ReturnType<typeof useTranslations<'landing'>>

/* ── Nav ─────────────────────────────────────────────────────────────── */

function Nav({
  t, locale, theme, onToggleTheme, onSwitchLocale,
}: {
  t: T; locale: string; theme: 'dark' | 'light'
  onToggleTheme: () => void; onSwitchLocale: (c: string) => void
}) {
  const [openLang, setOpenLang] = useState(false)
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 40,
      backdropFilter: 'blur(14px)',
      background: 'color-mix(in srgb, var(--ld-bg) 82%, transparent)',
      borderBottom: '1px solid var(--ld-border)',
    }}>
      <div style={{ ...wrap, display: 'flex', alignItems: 'center', gap: 16, height: 62 }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.4px', flexShrink: 0 }}>
          {t('brand')}
          <span style={{
            marginLeft: 7, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: 'var(--ld-accent-wash)', color: 'var(--ld-accent)',
            verticalAlign: 'middle', letterSpacing: '.04em',
          }}>{t('brandTag')}</span>
        </span>

        <div style={{ flex: 1 }} />

        <button onClick={onToggleTheme} aria-label={t('toggleTheme')} style={iconBtn}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div style={{ position: 'relative' }}>
          <button onClick={() => setOpenLang(v => !v)} style={{ ...iconBtn, width: 'auto', padding: '0 10px', gap: 6 }}>
            <Globe size={15} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {LOCALES.find(l => l.code === locale)?.label ?? locale}
            </span>
          </button>
          {openLang && (
            <div style={{
              position: 'absolute', right: 0, top: 40, minWidth: 108, padding: 4,
              background: 'var(--ld-surface)', border: '1px solid var(--ld-border)',
              borderRadius: 10, boxShadow: 'var(--ld-shadow)',
            }}>
              {LOCALES.map(l => (
                <button
                  key={l.code}
                  onClick={() => { onSwitchLocale(l.code); setOpenLang(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
                    borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5,
                    background: l.code === locale ? 'var(--ld-accent-wash)' : 'transparent',
                    color: l.code === locale ? 'var(--ld-accent)' : 'var(--ld-text-soft)',
                    fontWeight: l.code === locale ? 700 : 500,
                  }}
                >{l.label}</button>
              ))}
            </div>
          )}
        </div>

        <a href="#demo" style={{ ...primaryBtn, padding: '8px 16px', fontSize: 12.5 }}>
          {t('navCta')}
        </a>
      </div>
    </nav>
  )
}

/* ── Hero ────────────────────────────────────────────────────────────── */

function Hero({ t }: { t: T }) {
  return (
    <header style={{ background: 'var(--ld-glow)', paddingTop: 72, paddingBottom: 56 }}>
      <div style={{ ...wrap, textAlign: 'center' }}>
        <span style={{
          display: 'inline-block', padding: '5px 13px', borderRadius: 999, marginBottom: 22,
          background: 'var(--ld-accent-wash)', color: 'var(--ld-accent)',
          fontSize: 12, fontWeight: 700, border: '1px solid var(--ld-border)',
        }}>{t('heroBadge')}</span>

        <h1 style={{
          fontSize: 'clamp(34px, 6vw, 60px)', fontWeight: 850, lineHeight: 1.08,
          letterSpacing: '-1.8px', margin: '0 0 20px', maxWidth: 860, marginInline: 'auto',
        }}>
          {t('heroTitle')}<br />
          <span style={{ color: 'var(--ld-accent)' }}>{t('heroTitleAccent')}</span>
        </h1>

        <p style={{
          fontSize: 'clamp(15px, 2vw, 18px)', color: 'var(--ld-text-soft)', lineHeight: 1.65,
          maxWidth: 620, margin: '0 auto 30px',
        }}>{t('heroSubtitle')}</p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="#demo" style={primaryBtn}>
            {t('heroCta')} <ArrowRight size={16} />
          </a>
          <a href="#product" style={ghostBtn}>{t('heroCtaSecondary')}</a>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--ld-text-muted)' }}>
          {t('heroNote')}
        </p>
      </div>
    </header>
  )
}

/* ── Problem ─────────────────────────────────────────────────────────── */

function Problem({ t }: { t: T }) {
  const items = ['problem1', 'problem2', 'problem3'] as const
  return (
    <Section>
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <SectionTitle>{t('problemTitle')}</SectionTitle>
        <p style={lead}>{t('problemLead')}</p>
      </div>
      <div style={{ ...grid3, marginTop: 34 }}>
        {items.map(k => (
          <div key={k} style={card}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--ld-text-soft)' }}>
              {t(k)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ── Interactive demo ────────────────────────────────────────────────── */

function DemoSection({
  t, screen, onScreenChange,
}: {
  t: T; screen: Screen; onScreenChange: (s: Screen) => void
}) {
  return (
    <Section id="product" soft>
      <div style={{ maxWidth: 700, margin: '0 auto 30px', textAlign: 'center' }}>
        <SectionTitle>{t('productTitle')}</SectionTitle>
        <p style={lead}>{t('productLead')}</p>
      </div>
      <ProductDemo screen={screen} onScreenChange={onScreenChange} />
      <p style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: 'var(--ld-text-muted)' }}>
        {t('productNote')}
      </p>
    </Section>
  )
}

/* ── Differentiators ─────────────────────────────────────────────────── */

function Differentiators({ t }: { t: T }) {
  const items = [
    { icon: Globe, k: 'diff1' },
    { icon: Languages, k: 'diff2' },
    { icon: Gauge, k: 'diff3' },
    { icon: Users2, k: 'diff4' },
    { icon: Target, k: 'diff5' },
    { icon: ShieldCheck, k: 'diff6' },
  ] as const
  return (
    <Section>
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <SectionTitle>{t('diffTitle')}</SectionTitle>
        <p style={lead}>{t('diffLead')}</p>
      </div>
      <div style={{ ...grid3, marginTop: 34 }}>
        {items.map(({ icon: Icon, k }) => (
          <div key={k} style={card}>
            <span style={{
              display: 'inline-flex', width: 34, height: 34, borderRadius: 9, marginBottom: 12,
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--ld-accent-wash)', color: 'var(--ld-accent)',
            }}><Icon size={17} /></span>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>{t(`${k}Title`)}</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ld-text-soft)' }}>
              {t(`${k}Body`)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ── Also included ───────────────────────────────────────────────────── */

function AlsoIncluded({ t }: { t: T }) {
  // Rounds out the pitch with the features that don't earn their own demo
  // screen or differentiator card, but still show up in a real sales
  // conversation. Kept compact — icon, title, one line — on purpose.
  const items = [
    { icon: UserCog, k: 'also1' },
    { icon: Upload, k: 'also2' },
    { icon: Archive, k: 'also3' },
    { icon: ClipboardList, k: 'also4' },
    { icon: MapPin, k: 'also5' },
    { icon: Settings2, k: 'also6' },
  ] as const
  return (
    <Section>
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <SectionTitle>{t('alsoTitle')}</SectionTitle>
        <p style={lead}>{t('alsoLead')}</p>
      </div>
      <div style={{ ...grid3, marginTop: 34 }}>
        {items.map(({ icon: Icon, k }) => (
          <div key={k} style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{
              display: 'inline-flex', width: 32, height: 32, borderRadius: 9, flexShrink: 0,
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--ld-accent-wash)', color: 'var(--ld-accent)',
            }}><Icon size={16} /></span>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700 }}>{t(`${k}Title`)}</h3>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ld-text-soft)' }}>
                {t(`${k}Body`)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ── How it works ────────────────────────────────────────────────────── */

// Each step maps to the screen of the live demo above that actually shows
// it — clicking a step scrolls up and switches the demo there, instead of a
// static GIF that would need re-recording every time the product changes.
const STEP_SCREEN: Record<string, Screen> = {
  step1: 'run', step2: 'leads', step3: 'conversations', step4: 'kanban',
}

function HowItWorks({ t, onStepClick }: { t: T; onStepClick: (s: Screen) => void }) {
  const steps = ['step1', 'step2', 'step3', 'step4'] as const
  return (
    <Section soft>
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <SectionTitle>{t('howTitle')}</SectionTitle>
        <p style={lead}>{t('howLead')}</p>
      </div>
      <div style={{
        marginTop: 34, display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))',
      }}>
        {steps.map((k, i) => (
          <button
            key={k}
            onClick={() => onStepClick(STEP_SCREEN[k])}
            style={{
              ...card, position: 'relative', textAlign: 'left', cursor: 'pointer',
              font: 'inherit', color: 'inherit', width: '100%', display: 'block', margin: 0,
              transition: 'border-color .15s, transform .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ld-accent)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--ld-border)'; e.currentTarget.style.transform = 'none' }}
          >
            <span style={{
              display: 'inline-flex', width: 26, height: 26, borderRadius: '50%',
              alignItems: 'center', justifyContent: 'center', marginBottom: 11,
              background: 'var(--ld-accent)', color: '#FFF', fontSize: 12, fontWeight: 800,
            }}>{i + 1}</span>
            <h3 style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 700 }}>{t(`${k}Title`)}</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, color: 'var(--ld-text-soft)' }}>
              {t(`${k}Body`)}
            </p>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
              fontWeight: 700, color: 'var(--ld-accent)',
            }}>
              <MonitorPlay size={13} /> {t('howStepCta')}
            </span>
          </button>
        ))}
      </div>
    </Section>
  )
}

/* ── Plans ───────────────────────────────────────────────────────────── */

function Plans({ t }: { t: T }) {
  // Seats and lead volumes come from PLAN_DEFAULTS in the app, so they are
  // real. Prices are deliberately absent: every deal is quoted in a
  // conversation, and inventing a number here would be the one claim on this
  // page nobody could stand behind.
  const plans = [
    { k: 'planBasic', seats: 3, leads: '1,000' },
    { k: 'planPremium', seats: 7, leads: '3,000', featured: true },
    { k: 'planEnterprise', seats: 15, leads: '10,000' },
  ] as const

  return (
    <Section id="plans">
      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
        <SectionTitle>{t('plansTitle')}</SectionTitle>
        <p style={lead}>{t('plansLead')}</p>
      </div>

      <div style={{
        marginTop: 34, display: 'grid', gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
      }}>
        {plans.map(p => (
          <div key={p.k} style={{
            ...card,
            border: `1px solid ${'featured' in p && p.featured ? 'var(--ld-accent)' : 'var(--ld-border)'}`,
            position: 'relative',
          }}>
            {'featured' in p && p.featured && (
              <span style={{
                position: 'absolute', top: -9, left: 18, padding: '2px 9px', borderRadius: 5,
                background: 'var(--ld-accent)', color: '#FFF', fontSize: 9.5, fontWeight: 800,
                letterSpacing: '.05em', textTransform: 'uppercase',
              }}>{t('planPopular')}</span>
            )}
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>{t(`${p.k}Name`)}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ld-text-muted)', lineHeight: 1.5 }}>
              {t(`${p.k}For`)}
            </p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{p.seats}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ld-text-muted)' }}>{t('planSeats')}</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{p.leads}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ld-text-muted)' }}>{t('planLeads')}</div>
              </div>
            </div>
            <a href="#demo" style={{
              display: 'block', textAlign: 'center', padding: '8px 0', borderRadius: 8,
              fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
              background: 'featured' in p && p.featured ? 'var(--ld-accent)' : 'transparent',
              color: 'featured' in p && p.featured ? '#FFF' : 'var(--ld-accent)',
              border: `1px solid ${'featured' in p && p.featured ? 'var(--ld-accent)' : 'var(--ld-border)'}`,
            }}>{t('planCta')}</a>
          </div>
        ))}
      </div>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--ld-text-soft)' }}>
        {t('plansPricingNote')}
      </p>
    </Section>
  )
}

/* ── Demo request form ───────────────────────────────────────────────── */

function DemoForm({ t, locale }: { t: T; locale: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [form, setForm] = useState({
    full_name: '', email: '', company: '', phone: '', team_size: '', message: '',
    website: '', // honeypot — hidden from humans, see the API route
  })

  const canSend = form.full_name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSend || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, locale, source_path: window.location.pathname }),
      })
      setState(res.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <Section id="demo" soft>
        <div style={{ ...card, maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <span style={{
            display: 'inline-flex', width: 44, height: 44, borderRadius: '50%', marginBottom: 14,
            alignItems: 'center', justifyContent: 'center', background: '#22C55E22', color: '#22C55E',
          }}><Check size={22} /></span>
          <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>{t('formSentTitle')}</h3>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ld-text-soft)', lineHeight: 1.6 }}>
            {t('formSentBody')}
          </p>
        </div>
      </Section>
    )
  }

  return (
    <Section id="demo" soft>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <SectionTitle>{t('formTitle')}</SectionTitle>
          <p style={lead}>{t('formLead')}</p>
        </div>

        <form onSubmit={submit} style={{ ...card, display: 'grid', gap: 13 }}>
          <div style={{ display: 'grid', gap: 13, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
            <Field label={t('formName')} required>
              <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} style={input} />
            </Field>
            <Field label={t('formEmail')} required>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={input} />
            </Field>
            <Field label={t('formCompany')}>
              <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} style={input} />
            </Field>
            <Field label={t('formTeamSize')}>
              <select value={form.team_size} onChange={e => setForm({ ...form, team_size: e.target.value })} style={input}>
                <option value="">—</option>
                <option value="1-3">1–3</option>
                <option value="4-10">4–10</option>
                <option value="11-25">11–25</option>
                <option value="25+">25+</option>
              </select>
            </Field>
          </div>

          <Field label={t('formMessage')}>
            <textarea
              rows={3}
              value={form.message}
              onChange={e => setForm({ ...form, message: e.target.value })}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {/* Honeypot. Hidden from people, irresistible to form-filling bots.
              aria-hidden + tabIndex keeps it away from screen readers and
              keyboard users, who would otherwise land on a field that must
              stay empty. */}
          <input
            value={form.website}
            onChange={e => setForm({ ...form, website: e.target.value })}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />

          {state === 'error' && (
            <p style={{ margin: 0, fontSize: 12.5, color: '#EF4444' }}>{t('formError')}</p>
          )}

          <button
            type="submit"
            disabled={!canSend || state === 'sending'}
            style={{
              ...primaryBtn, width: '100%', justifyContent: 'center', marginTop: 2,
              opacity: canSend && state !== 'sending' ? 1 : 0.5,
              cursor: canSend && state !== 'sending' ? 'pointer' : 'not-allowed',
              border: 'none',
            }}
          >
            {state === 'sending'
              ? <><Loader2 size={16} style={{ animation: 'ld-spin 1s linear infinite' }} /> {t('formSending')}</>
              : <>{t('formSubmit')} <ArrowRight size={16} /></>}
          </button>

          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ld-text-muted)', textAlign: 'center' }}>
            {t('formPrivacy')}
          </p>
        </form>
      </div>
    </Section>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 5,
        color: 'var(--ld-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em',
      }}>
        {label}{required && <span style={{ color: 'var(--ld-accent)' }}> *</span>}
      </span>
      {children}
    </label>
  )
}

/* ── Footer ──────────────────────────────────────────────────────────── */

function Footer({ t }: { t: T }) {
  return (
    <footer style={{ borderTop: '1px solid var(--ld-border)', padding: '30px 0' }}>
      <div style={{ ...wrap, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{t('brand')}</span>
        <span style={{ fontSize: 12, color: 'var(--ld-text-muted)' }}>{t('footerTagline')}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--ld-text-muted)' }}>{t('footerRights')}</span>
      </div>
    </footer>
  )
}

/* ── Shared bits ─────────────────────────────────────────────────────── */

const wrap: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '0 22px' }

function Section({ children, id, soft }: { children: React.ReactNode; id?: string; soft?: boolean }) {
  return (
    <section id={id} style={{ padding: '58px 0', background: soft ? 'var(--ld-bg-soft)' : 'transparent' }}>
      <div style={wrap}>{children}</div>
    </section>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 'clamp(24px, 3.6vw, 36px)', fontWeight: 800, letterSpacing: '-1px',
      margin: '0 0 12px', lineHeight: 1.15,
    }}>{children}</h2>
  )
}

const lead: React.CSSProperties = {
  fontSize: 15, color: 'var(--ld-text-soft)', lineHeight: 1.65, margin: 0,
}

const grid3: React.CSSProperties = {
  display: 'grid', gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
}

const card: React.CSSProperties = {
  background: 'var(--ld-surface)', border: '1px solid var(--ld-border)',
  borderRadius: 13, padding: '20px 22px',
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px',
  borderRadius: 10, background: 'var(--ld-accent)', color: '#FFF',
  fontSize: 14, fontWeight: 700, textDecoration: 'none', cursor: 'pointer',
}

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px',
  borderRadius: 10, background: 'transparent', color: 'var(--ld-text)',
  border: '1px solid var(--ld-border)', fontSize: 14, fontWeight: 600, textDecoration: 'none',
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--ld-border)', color: 'var(--ld-text-soft)',
}

const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--ld-bg)', border: '1px solid var(--ld-border)',
  color: 'var(--ld-text)', outline: 'none', boxSizing: 'border-box',
}

export { Zap }
