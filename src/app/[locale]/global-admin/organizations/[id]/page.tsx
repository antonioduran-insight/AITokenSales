'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { createClient } from '@/lib/supabase/client'
import type { Organization, OrganizationAddon, Vendor } from '@/lib/types'
import { ADDON_LIST, PLAN_DEFAULTS } from '@/lib/types'

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6', premium: '#8B5CF6', enterprise: '#F59E0B', ultra: '#EF4444',
}

type OrgDetail = Organization & {
  admin_email: string | null
  sdr_count: number
  addons: OrganizationAddon[]
  leads_this_month: number
}

type AddonType = typeof ADDON_LIST[number]['type']

function generateSlug(name: string) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function OrgDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const locale = useLocale()
  const { colors, t } = useGlobalAdminTheme()

  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState<'basic' | 'premium' | 'enterprise' | 'ultra'>('basic')
  const [maxSeats, setMaxSeats] = useState<number>(3)
  const [maxLeads, setMaxLeads] = useState<number>(1000)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendor, setVendor] = useState('direct')
  const [vendorCustom, setVendorCustom] = useState('')
  const [billingDay, setBillingDay] = useState<number>(10)
  const [defaultLanguage, setDefaultLanguage] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [internalNotes, setInternalNotes] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [savedInfo, setSavedInfo] = useState(false)
  const [saveInfoError, setSaveInfoError] = useState('')

  const [activeAddons, setActiveAddons] = useState<Set<string>>(new Set())
  const [togglingAddon, setTogglingAddon] = useState<string | null>(null)

  const [deactivating, setDeactivating] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [confirmReactivate, setConfirmReactivate] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [apifyToken, setApifyToken] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://api.aitokenking.com.tw/api/v1')
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4.6')
  const [savingKeys, setSavingKeys] = useState(false)
  const [savedKeys, setSavedKeys] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, vendorsRes] = await Promise.all([
        fetch(`/api/global-admin/organizations/${id}`),
        fetch('/api/global-admin/vendors'),
      ])
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const vendorsData: Vendor[] = await vendorsRes.json().then(d => Array.isArray(d) ? d : []).catch(() => [])
      setVendors(vendorsData)

      setOrg(data)
      setName(data.name)
      setSlug(data.slug)
      setPlan(data.plan ?? 'basic')
      setMaxSeats(data.max_seats ?? 3)
      setMaxLeads(data.max_leads_per_month ?? 1000)
      setBillingDay(data.billing_day ?? 10)
      setDefaultLanguage(data.default_language ?? 'zh')
      setLogoUrl(data.logo_url ?? '')
      setLogoPreview(data.logo_url ?? '')
      setInternalNotes(data.internal_notes ?? '')
      setAdminEmail(data.admin_email ?? '')
      setApifyToken(data.apify_token ?? '')
      setAnthropicKey(data.anthropic_key ?? '')
      setAnthropicBaseUrl(data.anthropic_base_url ?? 'https://api.aitokenking.com.tw/api/v1')
      setAnthropicModel(data.anthropic_model ?? 'claude-sonnet-4.6')
      setActiveAddons(new Set(data.addons.map((a: OrganizationAddon) => a.addon_type)))

      // QA-F28: Vendor used to be free text, risking silent duplicates from
      // a typo (e.g. "testvendor" vs "TestVendor") that split revenue
      // reporting. Derive the select's value here (vendors are guaranteed
      // loaded by this point, fetched above alongside the org itself) — an
      // exact match selects that vendor directly, anything else (including
      // a pre-existing free-text value from before this fix) falls back to
      // "other" with the raw text preserved instead of losing it.
      const rawVendor = data.vendor ?? ''
      if (!rawVendor) { setVendor('direct'); setVendorCustom('') }
      else if (vendorsData.some(v => v.name === rawVendor)) { setVendor(rawVendor); setVendorCustom('') }
      else { setVendor('other'); setVendorCustom(rawVendor) }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function handleNameChange(newName: string) {
    setName(newName)
    setSlug(generateSlug(newName))
  }

  // QA-F3: mirrors New Organization's own handlePlanChange — changing plan
  // here should auto-fill seats/leads the same way it does at creation time.
  function handlePlanChange(newPlan: typeof plan) {
    setPlan(newPlan)
    const defaults = PLAN_DEFAULTS[newPlan]
    if (defaults) { setMaxSeats(defaults.max_seats); setMaxLeads(defaults.max_leads_per_month) }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const fileName = `org-logos/${id}-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName)
      setLogoUrl(urlData.publicUrl)
      setLogoPreview(urlData.publicUrl)
    } catch (err) {
      console.error('Logo upload failed:', err)
    } finally {
      setLogoUploading(false)
    }
  }

  async function saveInfo() {
    setSavingInfo(true)
    setSaveInfoError('')
    try {
      const effectiveVendor = vendor === 'direct' ? null : vendor === 'other' ? (vendorCustom.trim() || null) : vendor
      const res = await fetch(`/api/global-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, slug, vendor: effectiveVendor, billing_day: billingDay, default_language: defaultLanguage, logo_url: logoUrl || null,
          plan, max_seats: maxSeats, max_leads_per_month: maxLeads,
          admin_email: adminEmail || undefined,
          admin_password: adminPassword || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveInfoError(data.error ?? 'Failed to save'); return }
      setAdminPassword('') // never keep a typed password around longer than needed
      setSavedInfo(true); setTimeout(() => setSavedInfo(false), 2000)
    } catch (e) {
      setSaveInfoError(e instanceof Error ? e.message : 'Network error')
    } finally { setSavingInfo(false) }
  }

  async function saveApiKeys() {
    setSavingKeys(true)
    try {
      await fetch(`/api/global-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apify_token: apifyToken || null, anthropic_key: anthropicKey || null, anthropic_base_url: anthropicBaseUrl || null, anthropic_model: anthropicModel || null }),
      })
      setSavedKeys(true)
      setTimeout(() => setSavedKeys(false), 2000)
    } catch { /* network error */ } finally { setSavingKeys(false) }
  }

  async function saveNotes() {
    try {
      await fetch(`/api/global-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_notes: internalNotes || null }),
      })
    } catch { /* network error */ }
  }

  async function toggleAddon(addonType: AddonType) {
    setTogglingAddon(addonType)
    const isActive = activeAddons.has(addonType)
    try {
      if (isActive) {
        const res = await fetch(`/api/global-admin/organizations/${id}/addons`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addon_type: addonType }),
        })
        if (res.ok) setActiveAddons(prev => { const s = new Set(prev); s.delete(addonType); return s })
      } else {
        const res = await fetch(`/api/global-admin/organizations/${id}/addons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addon_type: addonType }),
        })
        if (res.ok) setActiveAddons(prev => new Set([...prev, addonType]))
      }
    } catch { /* network error */ } finally { setTogglingAddon(null) }
  }

  async function toggleActive() {
    if (!org) return
    if (!org.is_active) setConfirmReactivate(true)
    else setConfirmDeactivate(true)
  }

  async function doReactivate() {
    const res = await fetch(`/api/global-admin/organizations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    })
    setConfirmReactivate(false)
    if (res.ok) setOrg(prev => prev ? { ...prev, is_active: true } : prev)
  }

  async function doDeactivate() {
    setDeactivating(true)
    const res = await fetch(`/api/global-admin/organizations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    setDeactivating(false); setConfirmDeactivate(false)
    if (res.ok) setOrg(prev => prev ? { ...prev, is_active: false } : prev)
  }

  async function handleDeleteOrg() {
    setDeleting(true)
    const res = await fetch(`/api/global-admin/organizations/${id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) router.push(`/${locale}/global-admin/organizations`)
    else {
      const data = await res.json()
      setError(data.error)
      setShowDeleteConfirm(false)
    }
  }

  const card: React.CSSProperties = {
    backgroundColor: colors.surface, border: `1px solid ${colors.border}`,
    borderRadius: 10, padding: '20px 24px', marginBottom: 16,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    borderRadius: 7, color: colors.textPrimary, padding: '8px 12px', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 5, display: 'block',
  }
  const sectionTitle: React.CSSProperties = {
    fontSize: 14, fontWeight: 700, color: colors.textPrimary, marginBottom: 16, marginTop: 0,
  }

  if (loading) return <div style={{ color: colors.textSecondary, padding: 60, textAlign: 'center' }}>{t('loading')}</div>
  if (error || !org) return <div style={{ color: '#EF4444', padding: 40 }}>{error ?? 'Not found'}</div>

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 10, gap: 16, marginBottom: 20 }}>
        <button
          onClick={() => router.push(`/${locale}/global-admin/organizations`)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
        >
          <ArrowLeft size={14} /> Organizations
        </button>
        <span style={{ color: colors.textMuted }}>›</span>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.textPrimary }}>{org.name}</h1>
        <span style={{
          backgroundColor: (PLAN_COLORS[org.plan] ?? colors.accent) + '22',
          color: PLAN_COLORS[org.plan] ?? colors.accent,
          border: `1px solid ${(PLAN_COLORS[org.plan] ?? colors.accent)}44`,
          borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        }}>
          {org.plan}
        </span>
        <button
          onClick={toggleActive}
          style={{
            marginLeft: 'auto',
            backgroundColor: org.is_active ? '#22C55E22' : colors.surfaceRaised,
            color: org.is_active ? '#22C55E' : colors.textSecondary,
            border: `1px solid ${org.is_active ? '#22C55E44' : colors.border}`,
            borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
          }}
        >
          {org.is_active ? t('active') : t('inactive')}
        </button>
      </div>

      {/* Main grid */}
      <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* LEFT column */}
        <div>
          {/* Org Info */}
          <div style={card}>
            <h2 style={sectionTitle}>Organization Info</h2>

            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: colors.textMuted }}>
                  No logo
                </div>
              )}
              <label style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: `1px solid ${colors.border}`, borderRadius: 7, fontSize: 13, color: colors.textSecondary }}>
                  {logoUploading ? 'Uploading...' : 'Upload Logo'}
                </span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>{t('name')}</label>
                <input value={name} onChange={e => handleNameChange(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('slug')}</label>
                <input value={slug} onChange={e => setSlug(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>{t('vendor')}</label>
                <select value={vendor} onChange={e => setVendor(e.target.value)} style={inputStyle}>
                  <option value="direct">Direct (no vendor)</option>
                  {vendors.filter(v => v.is_active).map(v => (
                    <option key={v.id} value={v.name}>{v.name} ({v.commission_pct}%)</option>
                  ))}
                  <option value="other">Other (type below)</option>
                </select>
                {vendor === 'other' && (
                  <input
                    type="text"
                    placeholder="Vendor name"
                    value={vendorCustom}
                    onChange={e => setVendorCustom(e.target.value)}
                    style={{ ...inputStyle, marginTop: 6 }}
                    autoComplete="off"
                  />
                )}
              </div>
              <div>
                <label style={labelStyle}>{t('billingDay')}</label>
                <input type="number" min={1} max={28} value={billingDay} onChange={e => setBillingDay(Number(e.target.value))} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('defaultLanguage')}</label>
              <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} style={inputStyle}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="vi">Tiếng Việt</option>
              </select>
            </div>

            {/* QA-F3: plan/admin email/password used to require a direct DB edit */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t('plan')}</label>
              <select value={plan} onChange={e => handlePlanChange(e.target.value as typeof plan)} style={inputStyle}>
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
                <option value="ultra">Ultra</option>
              </select>
            </div>
            <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Max Seats</label>
                <input type="number" min={1} value={maxSeats} onChange={e => setMaxSeats(Number(e.target.value))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Max Leads / Month</label>
                <input type="number" min={1} value={maxLeads} onChange={e => setMaxLeads(Number(e.target.value))} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Admin Email</label>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} style={inputStyle} placeholder="admin@company.com" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Admin Password</label>
              <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} style={inputStyle} placeholder="Leave blank to keep current password" autoComplete="new-password" />
            </div>

            {saveInfoError && (
              <div style={{ padding: '8px 12px', backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 6, color: '#F87171', fontSize: 12, marginBottom: 14 }}>{saveInfoError}</div>
            )}

            <button
              onClick={saveInfo}
              disabled={savingInfo}
              style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingInfo ? 0.6 : 1 }}
            >
              {savingInfo ? t('saving') : savedInfo ? '✓ Saved' : 'Save Organization Info'}
            </button>
          </div>

          {/* Scraper API Keys */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Scraper API Keys</h2>
              {apifyToken && anthropicKey && (
                <span style={{ fontSize: 10, backgroundColor: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E30', borderRadius: 3, padding: '2px 8px', fontWeight: 600 }}>
                  ✓ Configured
                </span>
              )}
            </div>
            <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Apify Token</label>
                <input type="password" value={apifyToken} onChange={e => setApifyToken(e.target.value)} placeholder="apify_api_…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Key (ATK_API_KEY)</label>
                <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Base URL</label>
                <input value={anthropicBaseUrl} onChange={e => setAnthropicBaseUrl(e.target.value)} placeholder="https://api.aitokenking.com.tw/api/v1" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Model</label>
                <input value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)} placeholder="claude-sonnet-4.6" style={inputStyle} />
              </div>
            </div>
            <button
              onClick={saveApiKeys}
              disabled={savingKeys}
              style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingKeys ? 0.6 : 1 }}
            >
              {savingKeys ? 'Saving…' : savedKeys ? '✓ Saved' : 'Save API Keys'}
            </button>
          </div>

          {/* Internal Notes */}
          <div style={card}>
            <h2 style={sectionTitle}>{t('internalNotes')}</h2>
            <textarea
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              onBlur={saveNotes}
              rows={4}
              placeholder="Internal notes (not visible to the organization)..."
              style={{ ...inputStyle, resize: 'vertical', width: '100%' }}
            />
            <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, marginBottom: 0 }}>Auto-saves on blur</p>
          </div>
        </div>

        {/* RIGHT column */}
        <div>
          {/* Usage */}
          <div style={card}>
            <h2 style={sectionTitle}>Usage</h2>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SDRs</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary }}>
                  {org.sdr_count} <span style={{ fontSize: 13, color: colors.textMuted }}>/ {org.max_seats >= 2147483647 ? '∞' : org.max_seats}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Leads this month</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary }}>
                  {org.leads_this_month} <span style={{ fontSize: 13, color: colors.textMuted }}>/ {!org.max_leads_per_month || org.max_leads_per_month >= 2147483647 ? '∞' : org.max_leads_per_month.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Add-ons */}
          <div style={card}>
            <h2 style={sectionTitle}>{t('addOns')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ADDON_LIST.map(addon => {
                const isActive = activeAddons.has(addon.type)
                const isToggling = togglingAddon === addon.type
                return (
                  <label key={addon.type} style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    padding: '9px 12px', borderRadius: 8,
                    backgroundColor: isActive ? `${colors.accent}10` : colors.surfaceRaised,
                    border: `1px solid ${isActive ? colors.accent + '40' : colors.border}`,
                    opacity: isToggling ? 0.6 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggleAddon(addon.type)}
                      disabled={isToggling}
                      style={{ width: 14, height: 14, accentColor: colors.accent, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: colors.textPrimary, flex: 1 }}>{t(addon.labelKey)}</span>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{addon.price}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Danger Zone */}
          <div style={{ ...card, border: `1px solid ${colors.danger}33` }}>
            <h2 style={{ ...sectionTitle, color: colors.danger }}>Danger Zone</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {org.is_active ? (
                !confirmDeactivate ? (
                  <button
                    onClick={() => setConfirmDeactivate(true)}
                    style={{ backgroundColor: 'transparent', color: colors.danger, border: `1px solid ${colors.danger}`, borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                  >
                    {t('deactivate')}
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary }}>Disable this org?</span>
                    <button onClick={doDeactivate} disabled={deactivating} style={{ backgroundColor: colors.danger, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      {deactivating ? '…' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmDeactivate(false)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )
              ) : (
                !confirmReactivate ? (
                  <button
                    onClick={() => setConfirmReactivate(true)}
                    style={{ backgroundColor: 'transparent', color: '#22C55E', border: '1px solid #22C55E', borderRadius: 7, padding: '8px 14px', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                  >
                    Reactivate
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary }}>Reactivate?</span>
                    <button onClick={doReactivate} style={{ backgroundColor: '#22C55E', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      Confirm
                    </button>
                    <button onClick={() => setConfirmReactivate(false)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )
              )}
              <button
                onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText('') }}
                style={{ backgroundColor: '#EF444420', color: '#EF4444', border: '1px solid #EF4444', borderRadius: 7, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
              >
                Delete Organization
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: colors.surface, border: '1px solid #EF4444', borderRadius: 12, padding: 32, maxWidth: 400, width: '90%' }}>
            <h3 style={{ color: '#EF4444', margin: '0 0 12px', fontSize: 18 }}>Delete Organization</h3>
            <p style={{ color: colors.textSecondary, marginBottom: 16, fontSize: 14, lineHeight: 1.5 }}>
              This permanently deletes the org and all associated users, runs, and data. Cannot be undone.
            </p>
            <p style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 14 }}>
              Type <strong style={{ color: colors.textPrimary }}>{org.name}</strong> to confirm:
            </p>
            <input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={org.name}
              autoComplete="off"
              style={{ width: '100%', padding: '8px 12px', backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.textPrimary, marginBottom: 16, fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                disabled={deleteConfirmText !== org.name || deleting}
                onClick={handleDeleteOrg}
                style={{ backgroundColor: deleteConfirmText === org.name ? '#EF4444' : '#EF444440', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: deleteConfirmText === org.name ? 'pointer' : 'not-allowed', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
