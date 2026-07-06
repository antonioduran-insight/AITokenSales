'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import type { Organization, OrganizationAddon } from '@/lib/types'
import { ADDON_LIST } from '@/lib/types'

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',
  premium: '#8B5CF6',
  enterprise: '#F59E0B',
  ultra: '#EF4444',
}

type OrgDetail = Organization & {
  admin_email: string | null
  sdr_count: number
  addons: OrganizationAddon[]
  open_tickets_count: number
  leads_this_month: number
}

type AddonType = typeof ADDON_LIST[number]['type']

export default function OrgDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const locale = useLocale()
  const { colors, t } = useGlobalAdminTheme()

  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable fields
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [vendor, setVendor] = useState('')
  const [billingDay, setBillingDay] = useState<number>(10)
  const [defaultLanguage, setDefaultLanguage] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [savedInfo, setSavedInfo] = useState(false)

  const [activeAddons, setActiveAddons] = useState<Set<string>>(new Set())
  const [togglingAddon, setTogglingAddon] = useState<string | null>(null)

  const [deactivating, setDeactivating] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [confirmReactivate, setConfirmReactivate] = useState(false)

  const [apifyToken, setApifyToken] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [savingKeys, setSavingKeys] = useState(false)
  const [savedKeys, setSavedKeys] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/global-admin/organizations/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setOrg(data)
      setName(data.name)
      setSlug(data.slug)
      setVendor(data.vendor ?? '')
      setBillingDay(data.billing_day ?? 10)
      setDefaultLanguage(data.default_language ?? 'zh')
      setLogoUrl(data.logo_url ?? '')
      setInternalNotes(data.internal_notes ?? '')
      setApifyToken(data.apify_token ?? '')
      setAnthropicKey(data.anthropic_key ?? '')
      setActiveAddons(new Set(data.addons.map((a: OrganizationAddon) => a.addon_type)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function saveInfo() {
    setSavingInfo(true)
    try {
      const res = await fetch(`/api/global-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, vendor: vendor || null, billing_day: billingDay, default_language: defaultLanguage, logo_url: logoUrl || null }),
      })
      if (res.ok) { setSavedInfo(true); setTimeout(() => setSavedInfo(false), 2000) }
    } catch { /* network error */ } finally {
      setSavingInfo(false)
    }
  }

  async function saveApiKeys() {
    setSavingKeys(true)
    try {
      await fetch(`/api/global-admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apify_token: apifyToken || null, anthropic_key: anthropicKey || null }),
      })
      setSavedKeys(true)
      setTimeout(() => setSavedKeys(false), 2000)
    } catch { /* network error */ } finally {
      setSavingKeys(false)
    }
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
    } catch { /* network error */ } finally {
      setTogglingAddon(null)
    }
  }

  async function toggleActive() {
    if (!org) return
    if (!org.is_active) {
      setConfirmReactivate(true)
    } else {
      setConfirmDeactivate(true)
    }
  }

  async function doReactivate() {
    const res = await fetch(`/api/global-admin/organizations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    })
    setConfirmReactivate(false)
    if (res.ok) setOrg(prev => prev ? { ...prev, is_active: true } : prev)
  }

  async function doDeactivate() {
    setDeactivating(true)
    const res = await fetch(`/api/global-admin/organizations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    setDeactivating(false)
    setConfirmDeactivate(false)
    if (res.ok) setOrg(prev => prev ? { ...prev, is_active: false } : prev)
  }

  const card: React.CSSProperties = {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: '20px 24px',
    marginBottom: 20,
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
    <div style={{ maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
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
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={toggleActive}
            style={{
              backgroundColor: org.is_active ? '#22C55E22' : colors.surfaceRaised,
              color: org.is_active ? '#22C55E' : colors.textSecondary,
              border: `1px solid ${org.is_active ? '#22C55E44' : colors.border}`,
              borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
            }}
          >
            {org.is_active ? t('active') : t('inactive')}
          </button>
        </div>
      </div>

      {/* Usage card */}
      <div style={card}>
        <h2 style={sectionTitle}>Usage</h2>
        <div style={{ display: 'flex', gap: 32 }}>
          <div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SDRs</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary }}>
              {org.sdr_count} <span style={{ fontSize: 14, color: colors.textMuted }}>/ {org.max_seats >= 2147483647 ? '∞' : org.max_seats}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Leads this month</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary }}>
              {org.leads_this_month} <span style={{ fontSize: 14, color: colors.textMuted }}>/ {!org.max_leads_per_month || org.max_leads_per_month >= 2147483647 ? '∞' : org.max_leads_per_month.toLocaleString()}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('openTickets')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: org.open_tickets_count > 0 ? '#F59E0B' : colors.textPrimary }}>
              {org.open_tickets_count}
            </div>
          </div>
        </div>
      </div>

      {/* Info card */}
      <div style={card}>
        <h2 style={sectionTitle}>Organization Info</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>{t('name')}</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('slug')}</label>
            <input value={slug} onChange={e => setSlug(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>{t('vendor')}</label>
            <input value={vendor} onChange={e => setVendor(e.target.value)} style={inputStyle} placeholder="e.g. Partner Name" />
          </div>
          <div>
            <label style={labelStyle}>{t('billingDay')}</label>
            <input type="number" min={1} max={28} value={billingDay} onChange={e => setBillingDay(Number(e.target.value))} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>{t('defaultLanguage')}</label>
            <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} style={inputStyle}>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t('logoUrl')}</label>
            <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} style={inputStyle} placeholder="https://..." />
          </div>
        </div>
        <button
          onClick={saveInfo}
          disabled={savingInfo}
          style={{ backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingInfo ? 0.6 : 1 }}
        >
          {savingInfo ? t('saving') : savedInfo ? t('saved') : t('save')}
        </button>
      </div>

      {/* Add-ons card */}
      <div style={card}>
        <h2 style={sectionTitle}>{t('addOns')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ADDON_LIST.map(addon => {
            const isActive = activeAddons.has(addon.type)
            const isToggling = togglingAddon === addon.type
            return (
              <label key={addon.type} style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                padding: '10px 14px', borderRadius: 8,
                backgroundColor: isActive ? `${colors.accent}10` : colors.surfaceRaised,
                border: `1px solid ${isActive ? colors.accent + '40' : colors.border}`,
                transition: 'all 0.15s',
                opacity: isToggling ? 0.6 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleAddon(addon.type)}
                  disabled={isToggling}
                  style={{ width: 16, height: 16, accentColor: colors.accent, cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: colors.textPrimary }}>{t(addon.labelKey)}</span>
                </div>
                <span style={{ fontSize: 12, color: colors.textMuted }}>{addon.price}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Scraper API Keys card */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Scraper API Keys</h2>
          {apifyToken && anthropicKey && (
            <span style={{ fontSize: 10, backgroundColor: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E30', borderRadius: 3, padding: '2px 8px', fontWeight: 600 }}>
              ✓ Configured
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Apify Token</label>
            <input type="password" value={apifyToken} onChange={e => setApifyToken(e.target.value)} placeholder="apify_api_…" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Anthropic API Key</label>
            <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" style={inputStyle} />
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

      {/* Internal Notes card */}
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

      {/* Danger Zone */}
      <div style={{ ...card, border: `1px solid ${colors.danger}33` }}>
        <h2 style={{ ...sectionTitle, color: colors.danger }}>Danger Zone</h2>
        {org.is_active ? (
          !confirmDeactivate ? (
            <button
              onClick={() => setConfirmDeactivate(true)}
              style={{
                backgroundColor: 'transparent', color: colors.danger,
                border: `1px solid ${colors.danger}`, borderRadius: 7,
                padding: '8px 16px', fontSize: 13, cursor: 'pointer',
              }}
            >
              {t('deactivate')}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>Are you sure? This will disable the organization.</span>
              <button onClick={doDeactivate} disabled={deactivating} style={{ backgroundColor: colors.danger, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                {deactivating ? 'Deactivating...' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmDeactivate(false)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                {t('cancel')}
              </button>
            </div>
          )
        ) : (
          !confirmReactivate ? (
            <button
              onClick={() => setConfirmReactivate(true)}
              style={{
                backgroundColor: 'transparent', color: '#22C55E',
                border: '1px solid #22C55E', borderRadius: 7,
                padding: '8px 16px', fontSize: 13, cursor: 'pointer',
              }}
            >
              Reactivate Organization
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>Reactivate this organization? Users will be able to log in again.</span>
              <button onClick={doReactivate} style={{ backgroundColor: '#22C55E', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                Confirm
              </button>
              <button onClick={() => setConfirmReactivate(false)} style={{ backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                {t('cancel')}
              </button>
            </div>
          )
        )}
      </div>
    </div>
  )
}
