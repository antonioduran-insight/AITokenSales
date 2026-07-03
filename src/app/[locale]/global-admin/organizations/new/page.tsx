'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import type { Vendor } from '@/lib/types'

const MAX_INT = 2147483647

const PLAN_DEFAULTS: Record<string, { max_seats: number; max_leads_per_month: number }> = {
  basic:      { max_seats: 3,        max_leads_per_month: 1000 },
  premium:    { max_seats: 10,       max_leads_per_month: 3000 },
  enterprise: { max_seats: 15,       max_leads_per_month: 10000 },
  ultra:      { max_seats: MAX_INT,  max_leads_per_month: MAX_INT },
}

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Europe', 'Global']

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function generatePassword(): string {
  return `Temp${Math.random().toString(36).slice(2, 10)}!`
}

interface SuccessData {
  orgName: string
  email: string
  password: string
}

export default function NewOrganizationPage() {
  const locale = useLocale()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [copied, setCopied] = useState(false)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState<'basic' | 'premium' | 'enterprise' | 'ultra'>('basic')
  const [logoUrl, setLogoUrl] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState(generatePassword())
  const [maxSeats, setMaxSeats] = useState(3)
  const [maxLeads, setMaxLeads] = useState<number>(500)
  const [customPrice, setCustomPrice] = useState<number | null>(null)
  const [vendor, setVendor] = useState('direct')
  const [defaultLanguage, setDefaultLanguage] = useState('zh')
  const [markets, setMarkets] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState('')

  useEffect(() => {
    fetch('/api/global-admin/vendors')
      .then(r => r.json())
      .then(data => setVendors(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Auto-update slug from name
  useEffect(() => {
    setSlug(generateSlug(name))
  }, [name])

  // Update defaults when plan changes
  useEffect(() => {
    const defaults = PLAN_DEFAULTS[plan]
    setMaxSeats(defaults.max_seats)
    setMaxLeads(defaults.max_leads_per_month)
  }, [plan])  // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMarket(market: string) {
    setMarkets(prev =>
      prev.includes(market) ? prev.filter(m => m !== market) : [...prev, market]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/global-admin/create-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slug,
        plan,
        logo_url: logoUrl || null,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        max_seats: maxSeats,
        max_leads_per_month: maxLeads,
        custom_price: plan === 'enterprise' ? customPrice : null,
        vendor,
        default_language: defaultLanguage,
        markets,
        internal_notes: internalNotes || null,
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
    backgroundColor: '#1C1C27',
    border: '1px solid #2A2A3A',
    color: '#F0F0F5',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#8B8BA0',
    fontWeight: 600,
    display: 'block',
    marginBottom: 6,
  }

  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }

  if (success) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0A0A0F',
        padding: 32,
      }}>
        <div style={{
          backgroundColor: '#13131A',
          border: '1px solid #22C55E44',
          borderRadius: 12,
          padding: 40,
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F5', margin: '0 0 6px' }}>
            Organization Created
          </h2>
          <div style={{ fontSize: 16, color: '#A78BFA', marginBottom: 24 }}>{success.orgName}</div>
          <div style={{
            backgroundColor: '#1C1C27',
            border: '1px solid #2A2A3A',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            textAlign: 'left',
          }}>
            <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, marginBottom: 12, textTransform: 'uppercase' }}>
              Save these credentials — they won't be shown again
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#52526A', fontSize: 12 }}>Email: </span>
              <span style={{ color: '#F0F0F5', fontWeight: 600 }}>{success.email}</span>
            </div>
            <div>
              <span style={{ color: '#52526A', fontSize: 12 }}>Password: </span>
              <span style={{ color: '#F0F0F5', fontWeight: 600, fontFamily: 'monospace' }}>{success.password}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Email: ${success.email}\nPassword: ${success.password}`)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              style={{
                backgroundColor: '#6C63FF',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied!' : 'Copy credentials'}
            </button>
            <a
              href={`/${locale}/global-admin/organizations`}
              style={{
                backgroundColor: '#1C1C27',
                color: '#8B8BA0',
                border: '1px solid #2A2A3A',
                borderRadius: 6,
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Go to Organizations
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F0F0F5', marginBottom: 8 }}>New Organization</h1>
      <p style={{ color: '#52526A', fontSize: 13, marginBottom: 28 }}>
        Creates the organization and an admin user account.
      </p>

      {error && (
        <div style={{
          backgroundColor: '#3A1A1A',
          border: '1px solid #EF4444',
          borderRadius: 8,
          padding: '12px 16px',
          color: '#F87171',
          fontSize: 13,
          marginBottom: 20,
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Name & Slug */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="Acme Corp"
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Slug *</label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value)}
              required
              placeholder="acme-corp"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Plan */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Plan *</label>
          <select
            value={plan}
            onChange={e => setPlan(e.target.value as typeof plan)}
            required
            style={inputStyle}
          >
            <option value="basic">Basic ($550/mo)</option>
            <option value="premium">Premium ($2,300/mo)</option>
            <option value="enterprise">Enterprise (custom price)</option>
            <option value="ultra">Ultra (internal/free)</option>
          </select>
        </div>

        {plan === 'enterprise' && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Custom Price (USD/mo)</label>
            <input
              type="number"
              value={customPrice ?? ''}
              onChange={e => setCustomPrice(e.target.value ? Number(e.target.value) : null)}
              placeholder="0"
              style={inputStyle}
            />
          </div>
        )}

        {/* Admin Info */}
        <div style={{
          backgroundColor: '#13131A',
          border: '1px solid #2A2A3A',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 12, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', marginBottom: 14 }}>
            Admin Account
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Admin Name *</label>
              <input
                value={adminName}
                onChange={e => setAdminName(e.target.value)}
                required
                placeholder="John Doe"
                style={inputStyle}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Admin Email *</label>
              <input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                required
                placeholder="admin@company.com"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ ...fieldStyle, marginTop: 14 }}>
            <label style={labelStyle}>Temporary Password *</label>
            <input
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              required
              style={{ ...inputStyle, fontFamily: 'monospace' }}
            />
          </div>
        </div>

        {/* Limits */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Max Seats</label>
            <input
              type="number"
              value={maxSeats}
              onChange={e => setMaxSeats(Number(e.target.value))}
              min={1}
              style={inputStyle}
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Max Leads/month (blank = unlimited)</label>
            <input
              type="number"
              value={maxLeads}
              onChange={e => setMaxLeads(Number(e.target.value))}
              placeholder="Unlimited"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Vendor & Language */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Vendor</label>
            <select
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              style={inputStyle}
            >
              <option value="direct">Direct</option>
              {vendors.filter(v => v.is_active).map(v => (
                <option key={v.id} value={v.name}>{v.name}</option>
              ))}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Default Language</label>
            <select value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} style={inputStyle}>
              <option value="zh">Chinese (zh)</option>
              <option value="en">English (en)</option>
              <option value="vi">Vietnamese (vi)</option>
              <option value="es">Spanish (es)</option>
            </select>
          </div>
        </div>

        {/* Logo URL */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Logo URL (optional)</label>
          <input
            value={logoUrl}
            onChange={e => setLogoUrl(e.target.value)}
            placeholder="https://..."
            style={inputStyle}
          />
        </div>

        {/* Markets */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Markets</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {MARKETS.map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#F0F0F5', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={markets.includes(m)}
                  onChange={() => toggleMarket(m)}
                  style={{ accentColor: '#6C63FF' }}
                />
                {m}
              </label>
            ))}
          </div>
        </div>

        {/* Internal Notes */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Internal Notes</label>
          <textarea
            value={internalNotes}
            onChange={e => setInternalNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Internal notes (not visible to client)…"
          />
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: loading ? '#5A52E0' : '#6C63FF',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Creating…' : 'Create Organization'}
          </button>
          <a
            href={`/${locale}/global-admin/organizations`}
            style={{
              backgroundColor: '#1C1C27',
              color: '#8B8BA0',
              border: '1px solid #2A2A3A',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
