'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { Plus, Trash2 } from 'lucide-react'
import { OrgMarketsSettings } from '@/components/markets/OrgMarketsSettings'
import type { Organization, OrganizationAddon, ScraperComboMaster, User, SenderProfile } from '@/lib/types'

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',
  premium: '#8B5CF6',
  enterprise: '#F59E0B',
  ultra: '#EF4444',
}

const ADDON_LABELS: Record<string, string> = {
  account_management: 'Account Management',
  multi_workspace: 'Multi Workspace',
  extended_data_retention: 'Extended Data Retention',
  sso: 'SSO',
  linkedin_auto_messaging: 'LinkedIn Auto Messaging',
}

const S: Record<string, React.CSSProperties> = {
  page:    { padding: '28px 32px', color: 'var(--crm-text-primary)', maxWidth: 860 },
  card:    { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: 24, marginBottom: 24 },
  label:   { fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', marginBottom: 6, display: 'block' },
  input:   { width: '100%', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 7, color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  select:  { width: '100%', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 7, color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  btn:     { backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost:{ backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: 'var(--crm-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 16 },
}

// ────────────────────────────────────────────────────────────────────────────
// Progress bar helper
// ────────────────────────────────────────────────────────────────────────────
function Bar({ value, max, color = 'var(--crm-accent)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ height: 6, backgroundColor: 'var(--crm-border)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 3, transition: 'width .4s ease' }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 1 — Organization
// ────────────────────────────────────────────────────────────────────────────
function OrgTab() {
  const [org, setOrg] = useState<Organization | null>(null)
  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [blacklist, setBlacklist] = useState('')
  const [companyContext, setCompanyContext] = useState('')
  const [bridgeContext, setBridgeContext] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/settings/organization')
      .then(r => r.json())
      .then((d: Organization) => {
        setOrg(d)
        setName(d.name ?? '')
        setLogoUrl(d.logo_url ?? '')
        setBlacklist(d.domain_blacklist ?? '')
        setCompanyContext(d.company_context ?? '')
        setBridgeContext(d.bridge_context ?? '')
      })
  }, [])

  async function save() {
    setSaving(true); setError(null)
    const res = await fetch('/api/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, logo_url: logoUrl || null, domain_blacklist: blacklist || null, company_context: companyContext, bridge_context: bridgeContext }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setSaving(false); return }
    setOrg(prev => prev ? { ...prev, ...data } : data)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  async function handleLogoUpload(file: File) {
    if (!org) return
    setUploadingLogo(true)
    setLogoError(null)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${org.id}/logo.${ext}`
      const { error: upErr } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) { setLogoError(upErr.message); return }
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path)
      setLogoUrl(urlData.publicUrl + `?t=${Date.now()}`)
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  if (!org) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>Loading…</div>

  return (
    <div>
      <div style={S.card}>
        <p style={S.sectionTitle}>General</p>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Organization Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={S.input} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo" style={{ height: 44, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)' }} />
            )}
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }}
              />
              <button
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                style={{ ...S.btnGhost, fontSize: 12, padding: '6px 14px' }}
              >
                {uploadingLogo ? 'Uploading…' : logoUrl ? 'Change Logo' : 'Upload Logo'}
              </button>
              {logoError && <p style={{ fontSize: 12, color: '#EF4444', margin: '4px 0 0' }}>{logoError}</p>}
            </div>
          </div>
        </div>
      </div>

      <OrgMarketsSettings />

      <div style={S.card}>
        <p style={S.sectionTitle}>Company Context</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          Used to personalise the outreach messages the scraper generates.
        </p>
        <textarea
          value={companyContext}
          onChange={e => setCompanyContext(e.target.value)}
          rows={8}
          placeholder={"Describe what your company does, who you sell to, and any specific products or focus you want your outreach messages to mention. Example: We sell AI-powered CRM software to B2B sales teams in Asia. Right now we're pushing our new automation feature — mention it when relevant."}
          style={{ ...S.input, resize: 'vertical', minHeight: 140, lineHeight: 1.6 }}
        />
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>Bridge Context</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          Used to personalise the partnership messages Bridge generates when you confirm candidates.
        </p>
        <textarea
          value={bridgeContext}
          onChange={e => setBridgeContext(e.target.value)}
          rows={8}
          placeholder={"Describe what kind of partnerships you're looking for through Bridge — what you offer as a partner, what you're looking for in return, and any specific type of deal you want to prioritize right now. Example: We're looking for reseller partners in the SaaS space who serve mid-market companies. We offer 20% commission and full onboarding support."}
          style={{ ...S.input, resize: 'vertical', minHeight: 140, lineHeight: 1.6 }}
        />
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>Domain Blacklist</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          One domain or company name per line. These will be blocked from CSV imports and manual prospect creation.
        </p>
        <textarea
          value={blacklist}
          onChange={e => setBlacklist(e.target.value)}
          rows={6}
          placeholder={'competitor.com\nblocked-company.io'}
          style={{ ...S.input, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>

      {error && <p style={{ color: '#EF4444', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <button onClick={save} disabled={saving} style={S.btn}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 2 — Plan & Usage
// ────────────────────────────────────────────────────────────────────────────
interface PlanData {
  org: Organization & { custom_price?: number | null }
  sdrCount: number
  sdrs: Array<{ id: string; full_name: string; email: string; created_at: string }>
  leadsCount: number
  periodStart: string
  addons: OrganizationAddon[]
}

function PlanTab() {
  const router = useRouter()
  const locale = useLocale()
  const [data, setData] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBuySeats, setShowBuySeats] = useState(false)

  useEffect(() => {
    fetch('/api/settings/plan')
      .then(r => r.json())
      .then((d: PlanData) => {
        if (d && d.org) setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!data) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>Could not load the plan. Please reload the page.</div>

  const { org, sdrCount, sdrs, leadsCount, periodStart, addons } = data
  const maxSeats = org.max_seats ?? 0
  const maxLeads = org.max_leads_per_month ?? 0
  const isUnlimited = (n: number | null) => !n || n >= 999999
  const seatsUnlimited = org.plan === 'ultra' || isUnlimited(org.max_seats)
  const leadsUnlimited = org.plan === 'ultra' || isUnlimited(org.max_leads_per_month)
  const seatsAtLimit = !seatsUnlimited && sdrCount >= maxSeats
  const leadsAtLimit = !leadsUnlimited && leadsCount >= maxLeads

  const periodDate = new Date(periodStart)
  const nextPeriod = new Date(periodDate)
  nextPeriod.setMonth(nextPeriod.getMonth() + 1)

  return (
    <div>
      {/* Current plan */}
      <div style={S.card}>
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>Current Plan</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{
            backgroundColor: (PLAN_COLORS[org.plan] ?? '#6C63FF') + '22',
            color: PLAN_COLORS[org.plan] ?? '#6C63FF',
            border: `1px solid ${PLAN_COLORS[org.plan] ?? '#6C63FF'}44`,
            borderRadius: 6, padding: '6px 16px', fontSize: 16, fontWeight: 700, textTransform: 'uppercase',
          }}>
            {org.plan}
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--crm-text-primary)' }}>
              {org.plan === 'enterprise' && org.custom_price
                ? `$${org.custom_price.toLocaleString()}/mo`
                : org.plan === 'ultra' ? 'Internal'
                : org.plan === 'enterprise' ? 'Custom pricing'
                : org.plan === 'premium' ? '$2,300/mo'
                : '$550/mo'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
              Billing period: {periodDate.toLocaleDateString()} → {nextPeriod.toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Seats */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Seats</p>
          {seatsAtLimit ? (
            <button onClick={() => setShowBuySeats(true)} style={{ ...S.btn, padding: '6px 14px', fontSize: 12 }}>Buy More Seats</button>
          ) : org.plan === 'basic' ? (
            <button onClick={() => router.push(`/${locale}/settings?tab=plan`)} style={{ ...S.btnGhost, fontSize: 12 }}>Upgrade to Premium</button>
          ) : null}
        </div>

        {seatsUnlimited ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>Unlimited seats on your plan.</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{sdrCount} of {maxSeats} seats used</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: seatsAtLimit ? '#EF4444' : '#22C55E' }}>
                {maxSeats - sdrCount} remaining
              </span>
            </div>
            <Bar value={sdrCount} max={maxSeats} color={seatsAtLimit ? '#EF4444' : 'var(--crm-accent)'} />
          </>
        )}

        {sdrs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Active SDRs</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sdrs.map(sdr => (
                <div key={sdr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 7 }}>
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                    <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginLeft: 8 }}>{sdr.email}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', flexShrink: 0 }}>since {new Date(sdr.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Leads this period */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Leads This Period</p>
          {leadsAtLimit && (
            <button onClick={() => alert('Contact your account manager to purchase additional leads')} style={{ ...S.btn, padding: '6px 14px', fontSize: 12 }}>Buy More Leads</button>
          )}
        </div>

        {leadsUnlimited ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>Unlimited leads on your plan.</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{leadsCount.toLocaleString()} of {maxLeads.toLocaleString()} leads</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: leadsAtLimit ? '#EF4444' : '#22C55E' }}>
                {Math.max(0, maxLeads - leadsCount).toLocaleString()} remaining
              </span>
            </div>
            <Bar value={leadsCount} max={maxLeads} color={leadsAtLimit ? '#EF4444' : 'var(--crm-accent)'} />
          </>
        )}
        <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 10 }}>
          Resets on {nextPeriod.toLocaleDateString()} · Leads are deleted after 3 months. Add Extended Data Retention to keep them.
        </p>
      </div>

      {/* Add-ons */}
      <div style={S.card}>
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>Active Add-ons</p>
        {addons.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)' }}>No active add-ons.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {addons.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--crm-text-primary)' }}>{ADDON_LABELS[a.addon_type] ?? a.addon_type}</span>
                  <span style={{ display: 'inline-block', marginLeft: 10, fontSize: 10, backgroundColor: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E30', borderRadius: 3, padding: '1px 6px' }}>Active</span>
                </div>
                {a.price_monthly && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)' }}>${a.price_monthly}/mo</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buy Seats modal */}
      {showBuySeats && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 380, maxWidth: '90vw', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Buy More Seats</h3>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 20 }}>
              Contact us to add more seats to your plan. We&apos;ll get back to you within one business day.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <a href="mailto:placeholder@aitokenking.com?subject=Add+more+seats" style={{ ...S.btn, flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                Contact Us
              </a>
              <button onClick={() => setShowBuySeats(false)} style={{ ...S.btnGhost, flex: 1 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 4 — Scraper
// ────────────────────────────────────────────────────────────────────────────
function ScraperTab() {
  const [combos, setCombos] = useState<ScraperComboMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})

  const [sdrs, setSdrs] = useState<User[]>([])
  const [profilesBySdr, setProfilesBySdr] = useState<Record<string, SenderProfile[]>>({})
  const [openFormFor, setOpenFormFor] = useState<string | null>(null)
  const [formFields, setFormFields] = useState({ display_name: '', title: '', company: '', style_hint: '', language: '', is_default: true })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => setCombos(data))
      .catch(() => {})
      .finally(() => setLoading(false))

    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .then(({ data }) => { if (data) setSdrs(data as User[]) })

    fetch('/api/sender-profiles')
      .then(r => r.json())
      .then((profiles: SenderProfile[]) => {
        const map: Record<string, SenderProfile[]> = {}
        for (const p of profiles) {
          if (!map[p.user_id]) map[p.user_id] = []
          map[p.user_id].push(p)
        }
        setProfilesBySdr(map)
      })
      .catch(() => {})
  }, [])

  async function createProfile(sdrId: string) {
    if (!formFields.display_name || !formFields.title || !formFields.company) {
      setProfileError('Display name, title and company are required')
      return
    }
    setSavingProfile(true); setProfileError(null)
    try {
      const res = await fetch('/api/sender-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formFields, user_id: sdrId }),
      })
      const data = await res.json()
      if (!res.ok) { setProfileError(data.error ?? 'Failed to create'); return }
      setProfilesBySdr(prev => {
        const existing = prev[sdrId] ?? []
        const updated = formFields.is_default
          ? existing.map(p => ({ ...p, is_default: false }))
          : existing
        return { ...prev, [sdrId]: [...updated, data] }
      })
      setOpenFormFor(null)
      setFormFields({ display_name: '', title: '', company: '', style_hint: '', language: '', is_default: true })
    } catch { setProfileError('Network error') } finally { setSavingProfile(false) }
  }

  async function deleteProfile(sdrId: string, profileId: string) {
    await fetch(`/api/sender-profiles/${profileId}`, { method: 'DELETE' })
    setProfilesBySdr(prev => ({
      ...prev,
      [sdrId]: (prev[sdrId] ?? []).filter(p => p.id !== profileId),
    }))
  }

  async function setDefault(sdrId: string, profileId: string) {
    await fetch(`/api/sender-profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    })
    setProfilesBySdr(prev => ({
      ...prev,
      [sdrId]: (prev[sdrId] ?? []).map(p => ({ ...p, is_default: p.id === profileId })),
    }))
  }

  async function toggle(code: string, currentActive: boolean) {
    setToggling(p => ({ ...p, [code]: true }))
    try {
      const res = await fetch('/api/scraper-combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combo_code: code, is_active: !currentActive }),
      })
      if (res.ok) setCombos(prev => prev.map(c => c.code === code ? { ...c, org_active: !currentActive } : c))
    } catch { /* ignore */ }
    finally { setToggling(p => ({ ...p, [code]: false })) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--crm-text-muted)' }}>Loading…</div>

  const activeCount = combos.filter(c => c.org_active).length

  return (
    <div>
      {/* Sender Profiles — only shown when there are SDRs with scraper access */}
      {sdrs.length > 0 && (
        <div style={S.card}>
          <p style={S.sectionTitle}>Sender Profiles</p>
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
            Each SDR needs a default sender profile so the scraper can personalize outreach messages.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sdrs.map(sdr => {
              const profiles = profilesBySdr[sdr.id] ?? []
              const defaultProfile = profiles.find(p => p.is_default && p.is_active)
              const isOpen = openFormFor === sdr.id
              return (
                <div key={sdr.id} style={{ border: '1px solid var(--crm-border)', borderRadius: 8, overflow: 'hidden' }}>
                  {/* SDR header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 8, padding: '12px 16px', backgroundColor: 'var(--crm-surface-raised)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                      {defaultProfile ? (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: '#22C55E20', color: '#22C55E', fontWeight: 700 }}>
                          ✓ {defaultProfile.display_name}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: '#EF444420', color: '#EF4444', fontWeight: 700 }}>
                          No default profile
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setOpenFormFor(isOpen ? null : sdr.id); setProfileError(null); setFormFields({ display_name: '', title: '', company: '', style_hint: '', language: '', is_default: true }) }}
                      style={{ ...S.btn, padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Plus size={12} /> Add profile
                    </button>
                  </div>

                  {/* Existing profiles */}
                  {profiles.length > 0 && (
                    <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {profiles.map(p => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--crm-border)' }}>
                          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 13, fontWeight: p.is_default ? 700 : 400, color: 'var(--crm-text-primary)' }}>{p.display_name}</span>
                            <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginLeft: 8 }}>{p.title} · {p.company}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                            {p.is_default ? (
                              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', fontWeight: 700 }}>DEFAULT</span>
                            ) : (
                              <button
                                onClick={() => setDefault(sdr.id, p.id)}
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-muted)', cursor: 'pointer' }}
                              >
                                Set default
                              </button>
                            )}
                            <button
                              onClick={() => deleteProfile(sdr.id, p.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', display: 'flex', padding: 4 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Create form */}
                  {isOpen && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--crm-border)', backgroundColor: '#6C63FF06' }}>
                      {profileError && <p style={{ fontSize: 12, color: '#EF4444', margin: '0 0 10px' }}>{profileError}</p>}
                      <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={S.label}>Display name *</label>
                          <input value={formFields.display_name} onChange={e => setFormFields(p => ({ ...p, display_name: e.target.value }))} placeholder="John D." style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>Title *</label>
                          <input value={formFields.title} onChange={e => setFormFields(p => ({ ...p, title: e.target.value }))} placeholder="Sales Manager" style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>Company *</label>
                          <input value={formFields.company} onChange={e => setFormFields(p => ({ ...p, company: e.target.value }))} placeholder="AITokenKing" style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>Language</label>
                          {/* Codes must match the scraper's _language_instruction()
                              map (linkedin-scraper/api/message_generator.py).
                              Bare "zh" used to be the only Chinese option and the
                              backend resolves it to SIMPLIFIED — so picking it for a
                              Taiwan or Hong Kong SDR silently produced the wrong
                              script, with no way to ask for Traditional at all.
                              Portuguese was missing entirely even though Brazil and
                              Portugal are both configured as 'pt' in `markets`. */}
                          <select value={formFields.language} onChange={e => setFormFields(p => ({ ...p, language: e.target.value }))} style={S.select}>
                            <option value="">Automatic (match market)</option>
                            <option value="en">English</option>
                            <option value="zh-TW">繁體中文 (Traditional)</option>
                            <option value="zh-CN">简体中文 (Simplified)</option>
                            <option value="es">Español</option>
                            <option value="pt">Português</option>
                            <option value="vi">Tiếng Việt</option>
                          </select>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={S.label}>Style hint (optional)</label>
                          <input value={formFields.style_hint} onChange={e => setFormFields(p => ({ ...p, style_hint: e.target.value }))} placeholder="Professional, concise, focuses on ROI..." style={S.input} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--crm-text-secondary)' }}>
                          <input type="checkbox" checked={formFields.is_default} onChange={e => setFormFields(p => ({ ...p, is_default: e.target.checked }))} style={{ accentColor: 'var(--crm-accent)' }} />
                          Set as default
                        </label>
                        <button onClick={() => createProfile(sdr.id)} disabled={savingProfile} style={{ ...S.btn, opacity: savingProfile ? 0.6 : 1 }}>
                          {savingProfile ? 'Saving…' : 'Create profile'}
                        </button>
                        <button onClick={() => setOpenFormFor(null)} style={S.btnGhost}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={S.card}>
        <p style={S.sectionTitle}>Search Combos</p>
        <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
          Enable the search combos your team will use in New Pipeline. {activeCount > 0 && `${activeCount} active.`}
        </p>
        {combos.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>No combos available.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {combos.map(c => (
              <div key={c.code} style={{
                display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 16px',
                borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)',
                border: `1px solid ${c.org_active ? '#6C63FF30' : 'var(--crm-border)'}`,
                opacity: toggling[c.code] ? 0.6 : 1,
                transition: 'opacity .2s',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c.org_active ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)' }}>
                      {c.name}
                    </span>
                    {c.org_active && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', fontWeight: 700 }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '0 0 6px' }}>{c.description}</p>
                  )}
                  {c.title_keywords.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.title_keywords.slice(0, 5).map(kw => (
                        <span key={kw} style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 4,
                          backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
                          color: 'var(--crm-text-muted)',
                        }}>
                          {kw}
                        </span>
                      ))}
                      {c.title_keywords.length > 5 && (
                        <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', padding: '2px 0' }}>
                          +{c.title_keywords.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggle(c.code, !!c.org_active)}
                  disabled={toggling[c.code]}
                  style={{
                    flexShrink: 0, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: toggling[c.code] ? 'default' : 'pointer', border: 'none',
                    backgroundColor: c.org_active ? '#22C55E20' : 'var(--crm-border)',
                    color: c.org_active ? '#22C55E' : 'var(--crm-text-muted)',
                    transition: 'all .15s',
                  }}
                >
                  {c.org_active ? '● Enabled' : '○ Disabled'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Settings page
// ────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'organization', label: 'Organization' },
  { key: 'plan',         label: 'Plan & Usage' },
  { key: 'scraper',      label: 'Scraper' },
]

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const { user } = useUser()

  const tab = searchParams.get('tab') ?? 'organization'

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>Loading…</div>
  }

  if (user.role !== 'admin') {
    return (
      <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>
        <p style={{ fontSize: 15 }}>Settings are only accessible to organization admins.</p>
      </div>
    )
  }

  function setTab(key: string) {
    router.replace(`/${locale}/settings?tab=${key}`)
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      {/* Tab nav — scrolls horizontally instead of wrapping (wrapping would
          break the connected underline strip look) if it doesn't fit.
          QA-F23: the scroll container and the border used to be the same
          box, so the browser's horizontal scrollbar rendered flush against
          (visually merged into) the tab-bar's own border-bottom instead of
          at the edge of an actual scroll region. Splitting the border onto
          an outer wrapper and the overflow onto an inner one gives the
          scrollbar its own space below the tab labels, clear of the
          border-bottom line. */}
      <div style={{ marginBottom: 28, borderBottom: '1px solid var(--crm-border)' }}>
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 4 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 18px',
                fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)',
                borderBottom: tab === t.key ? '2px solid var(--crm-accent)' : '2px solid transparent',
                transition: 'color 0.15s',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'organization' && <OrgTab />}
      {tab === 'plan'         && <PlanTab />}
      {tab === 'scraper'      && <ScraperTab />}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>Loading…</div>}>
      <SettingsContent />
    </Suspense>
  )
}
