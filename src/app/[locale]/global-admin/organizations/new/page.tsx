'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import type { Vendor } from '@/lib/types'
import { ADDON_LIST, MAX_INT, PLAN_DEFAULTS } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { createClient } from '@/lib/supabase/client'

const PLAN_PREVIEW: Record<string, string> = {
  basic: '$550/mo · 3 seats · 1,000 leads/mo',
  premium: '$2,300/mo · 7 seats · 3,000 leads/mo',
  enterprise: 'Custom · 15 seats · 10,000 leads/mo',
  ultra: 'Internal · Unlimited',
}

function generateSlug(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function generatePassword(): string {
  return `Temp${Math.random().toString(36).slice(2, 10)}!`
}

interface SuccessData { orgName: string; email: string; password: string }

export default function NewOrganizationPage() {
  const locale = useLocale()
  const { colors, t } = useGlobalAdminTheme()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [copied, setCopied] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState<'basic' | 'premium' | 'enterprise' | 'ultra'>('basic')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState(generatePassword())
  const [maxSeats, setMaxSeats] = useState(3)
  const [maxLeads, setMaxLeads] = useState<number>(1000)
  const [customPrice, setCustomPrice] = useState<number | null>(null)
  const [vendor, setVendor] = useState('direct')
  const [vendorCustom, setVendorCustom] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState('zh')
  const [internalNotes, setInternalNotes] = useState('')
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set())
  const [apifyToken, setApifyToken] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://api.aitokenking.com.tw/api/v1')
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-5')
  const [orgTempId] = useState(() => `new-${Date.now()}`)

  useEffect(() => {
    fetch('/api/global-admin/vendors')
      .then(r => r.json())
      .then(data => setVendors(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  function handleNameChange(newName: string) {
    setName(newName)
    setSlug(generateSlug(newName))
  }

  function handlePlanChange(newPlan: typeof plan) {
    setPlan(newPlan)
    const defaults = PLAN_DEFAULTS[newPlan]
    if (defaults) { setMaxSeats(defaults.max_seats); setMaxLeads(defaults.max_leads_per_month) }
  }

  function toggleAddon(addonType: string) {
    setSelectedAddons(prev => {
      const next = new Set(prev)
      if (next.has(addonType)) next.delete(addonType)
      else next.add(addonType)
      return next
    })
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const fileName = `org-logos/${orgTempId}-${Date.now()}.${ext}`
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!apifyToken || !anthropicKey) {
      setError('Apify Token and Anthropic Key are required')
      return
    }

    const effectiveVendor = vendor === 'direct' ? null : vendor === 'other' ? (vendorCustom.trim() || null) : vendor

    setLoading(true)
    const res = await fetch('/api/global-admin/create-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, slug, plan,
        logo_url: logoUrl || null,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        max_seats: maxSeats,
        max_leads_per_month: maxLeads,
        custom_price: plan === 'enterprise' ? customPrice : null,
        vendor: effectiveVendor,
        default_language: defaultLanguage,
        internal_notes: internalNotes || null,
        addons: Array.from(selectedAddons),
        apify_token: apifyToken,
        anthropic_key: anthropicKey,
        anthropic_base_url: anthropicBaseUrl || null,
        anthropic_model: anthropicModel || null,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Unknown error')
      setLoading(false)
      return
    }

    setSuccess({ orgName: name, email: adminEmail, password: adminPassword })
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`,
    color: colors.textPrimary, borderRadius: 6, padding: '8px 12px',
    fontSize: 14, width: '100%', boxSizing: 'border-box', outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: colors.textSecondary, fontWeight: 600, display: 'block', marginBottom: 6,
  }
  const cardStyle: React.CSSProperties = {
    backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20,
  }

  if (success) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ backgroundColor: colors.surface, border: `1px solid #22C55E44`, borderRadius: 12, padding: 40, maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: '0 0 6px' }}>Organization Created</h2>
          <div style={{ fontSize: 16, color: '#A78BFA', marginBottom: 24 }}>{success.orgName}</div>
          <div style={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16, marginBottom: 24, textAlign: 'left' }}>
            <div style={{ fontSize: 11, color: colors.danger, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase' }}>
              Save these credentials — they won&apos;t be shown again
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: colors.textMuted, fontSize: 12 }}>Email: </span>
              <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{success.email}</span>
            </div>
            <div>
              <span style={{ color: colors.textMuted, fontSize: 12 }}>Password: </span>
              <span style={{ color: colors.textPrimary, fontWeight: 600, fontFamily: 'monospace' }}>{success.password}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => { navigator.clipboard.writeText(`Email: ${success.email}\nPassword: ${success.password}`); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {copied ? 'Copied!' : 'Copy credentials'}
            </button>
            <a href={`/${locale}/global-admin/organizations`} style={{ backgroundColor: colors.surfaceRaised, color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '10px 20px', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
              Go to Organizations
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, marginBottom: 4 }}>{t('newOrganization')}</h1>
        <p style={{ color: colors.textMuted, fontSize: 13, margin: 0 }}>Creates the organization and an admin user account.</p>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3A1A1A', border: '1px solid #EF4444', borderRadius: 8, padding: '12px 16px', color: '#F87171', fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} autoComplete="off">
        {/* Row 1: Org Info + Admin Account */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Left: Org info */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Organization Info</h2>

            {/* Logo upload */}
            <div>
              <label style={labelStyle}>Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: colors.textMuted }}>
                    No logo
                  </div>
                )}
                <label style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 12px', border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 13, color: colors.textSecondary }}>
                    {logoUploading ? 'Uploading...' : 'Upload'}
                  </span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            <div>
              <label style={labelStyle}>{t('name')} *</label>
              <input value={name} onChange={e => handleNameChange(e.target.value)} required placeholder="Acme Corp" style={inputStyle} autoComplete="off" />
            </div>

            <div>
              <label style={labelStyle}>{t('slug')} *</label>
              <input value={slug} onChange={e => setSlug(e.target.value)} required placeholder="acme-corp" style={inputStyle} autoComplete="off" />
            </div>

            <div>
              <label style={labelStyle}>{t('plan')} *</label>
              <select value={plan} onChange={e => handlePlanChange(e.target.value as typeof plan)} required style={inputStyle}>
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
                <option value="ultra">Ultra</option>
              </select>
              <div style={{ fontSize: 11, color: colors.accent, marginTop: 4, padding: '4px 8px', backgroundColor: `${colors.accent}10`, borderRadius: 4 }}>
                {PLAN_PREVIEW[plan]}
              </div>
            </div>

            {plan === 'enterprise' && (
              <div>
                <label style={labelStyle}>{t('customPrice')} (USD/mo)</label>
                <input type="number" value={customPrice ?? ''} onChange={e => setCustomPrice(e.target.value ? Number(e.target.value) : null)} placeholder="0" style={inputStyle} />
              </div>
            )}
          </div>

          {/* Right: Admin account */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Admin Account</h2>

            <div>
              <label style={labelStyle}>{t('adminName')} *</label>
              <input value={adminName} onChange={e => setAdminName(e.target.value)} required placeholder="John Doe" style={inputStyle} autoComplete="off" />
            </div>

            <div>
              <label style={labelStyle}>{t('adminEmail')} *</label>
              <input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                required
                placeholder="admin@company.com"
                style={inputStyle}
                autoComplete="new-password"
                name="admin-email-field"
              />
            </div>

            <div>
              <label style={labelStyle}>{t('temporaryPassword')} *</label>
              <input value={adminPassword} onChange={e => setAdminPassword(e.target.value)} required style={{ ...inputStyle, fontFamily: 'monospace' }} autoComplete="new-password" />
            </div>

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
              <label style={labelStyle}>{t('defaultLanguage')}</label>
              <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} style={inputStyle}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="vi">Tiếng Việt</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
        </div>

        {/* Row 2: Scraper Keys + Add-ons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Scraper API Keys — REQUIRED */}
          <div style={{ ...cardStyle, border: `1px solid ${colors.accent}44` }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>
              Scraper API Keys <span style={{ color: '#EF4444' }}>*</span>
            </h2>
            <p style={{ fontSize: 12, color: colors.textMuted, margin: '0 0 12px' }}>Required for the scraper pipeline.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>Apify Token *</label>
                <input type="password" value={apifyToken} onChange={e => setApifyToken(e.target.value)} placeholder="apify_api_…" style={inputStyle} autoComplete="new-password" />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Key (ATK_API_KEY) *</label>
                <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" style={inputStyle} autoComplete="new-password" />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Base URL</label>
                <input value={anthropicBaseUrl} onChange={e => setAnthropicBaseUrl(e.target.value)} placeholder="https://api.aitokenking.com.tw/api/v1" style={inputStyle} autoComplete="off" />
              </div>
              <div>
                <label style={labelStyle}>Anthropic Model</label>
                <input value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)} placeholder="claude-sonnet-5" style={inputStyle} autoComplete="off" />
              </div>
            </div>
          </div>

          {/* Add-ons */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>{t('addOns')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ADDON_LIST.map(addon => {
                const isActive = selectedAddons.has(addon.type)
                return (
                  <label key={addon.type} style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    padding: '8px 12px', borderRadius: 7,
                    backgroundColor: isActive ? `${colors.accent}10` : colors.surfaceRaised,
                    border: `1px solid ${isActive ? colors.accent + '40' : colors.border}`,
                  }}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggleAddon(addon.type)}
                      style={{ width: 14, height: 14, accentColor: colors.accent, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: colors.textPrimary, flex: 1 }}>{t(addon.labelKey)}</span>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{addon.price}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        {/* Internal Notes */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>{t('internalNotes')}</h2>
          <textarea
            value={internalNotes}
            onChange={e => setInternalNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Internal notes (not visible to client)…"
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: loading ? colors.accentHover : colors.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Creating…' : t('createOrganization')}
          </button>
          <a
            href={`/${locale}/global-admin/organizations`}
            style={{ backgroundColor: colors.surfaceRaised, color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 14, textDecoration: 'none', display: 'inline-block' }}
          >
            {t('cancel')}
          </a>
        </div>
      </form>
    </div>
  )
}
