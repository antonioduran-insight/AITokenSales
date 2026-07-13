'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { GripVertical, Plus, Trash2, X } from 'lucide-react'
import { TagInput } from '@/components/ui/TagInput'
import { AddonFeature } from '@/components/ui/AddonFeature'
import { useHasAddon } from '@/lib/hooks/useHasAddon'
import type {
  Organization, PipelineStage, OrganizationAddon, ScraperComboMaster, User, SenderProfile,
  ChannelFamilyType, OrgCompanySeedList, OrgIcpKeyword, OrgChannelHook,
} from '@/lib/types'

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Global']

const ICP_CATEGORIES = ['industry', 'ai_signal', 'decision_title', 'influencer_title'] as const
const ICP_CATEGORY_LABELS: Record<string, string> = {
  industry: 'Industry Keywords',
  ai_signal: 'Buying Signal Keywords',
  decision_title: 'Decision-Maker Title Keywords',
  influencer_title: 'Influencer Title Keywords',
}

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
  const [language, setLanguage] = useState('en')
  const [logoUrl, setLogoUrl] = useState('')
  const [blacklist, setBlacklist] = useState('')
  const [productDescription, setProductDescription] = useState('')
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
        setLanguage(d.default_language ?? 'en')
        setLogoUrl(d.logo_url ?? '')
        setBlacklist(d.domain_blacklist ?? '')
        setProductDescription(d.product_description ?? '')
      })
  }, [])

  async function save() {
    setSaving(true); setError(null)
    const res = await fetch('/api/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, default_language: language, logo_url: logoUrl || null, domain_blacklist: blacklist || null, product_description: productDescription || null }),
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Default Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)} style={S.select}>
              <option value="en">English</option>
              <option value="zh">Chinese (繁體)</option>
              <option value="vi">Vietnamese</option>
              <option value="id">Indonesian</option>
            </select>
          </div>
          <div>
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

      <div style={S.card}>
        <p style={S.sectionTitle}>Product Description</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          What your organization sells — used by the scraper backend so generated outreach messages can reference something concrete instead of an empty template.
        </p>
        <textarea
          value={productDescription}
          onChange={e => setProductDescription(e.target.value)}
          rows={4}
          placeholder="e.g. We help mid-size logistics companies cut fuel costs with route-optimization software…"
          style={{ ...S.input, resize: 'vertical' }}
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
// Tab 2 — Pipeline
// ────────────────────────────────────────────────────────────────────────────
function PipelineTab() {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pendingChanges, setPendingChanges] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6C63FF')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/pipeline-stages')
      .then(r => r.json())
      .then((d: PipelineStage[]) => {
        const deduped = d.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
        setStages(deduped)
        setLoading(false)
      })
  }, [])

  function onDragStart(idx: number) { setDragIdx(idx) }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const next = [...stages]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setStages(next)
    setDragIdx(idx)
  }

  function onDragEnd() {
    setDragIdx(null)
    setPendingChanges(true)
  }

  async function saveOrder() {
    setSaving(true); setPendingChanges(false)
    const payload = stages.map((s, i) => ({ id: s.id, name: s.name, color: s.color, position: i }))
    await fetch('/api/settings/pipeline-stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages: payload }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  function updateStage(idx: number, field: 'name' | 'color', value: string) {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
    setPendingChanges(true)
  }

  async function addStage() {
    if (!newName.trim()) return
    setAdding(true)
    const res = await fetch('/api/settings/pipeline-stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    })
    const data = await res.json()
    if (res.ok) {
      setStages(prev => [...prev, data as PipelineStage])
      setNewName('')
      setNewColor('#6C63FF')
      setPendingChanges(true)
    } else {
      setError(data.error)
    }
    setAdding(false)
  }

  async function deleteStage(stage: PipelineStage, idx: number) {
    if (stage.is_default) { setError('Cannot delete default stages'); return }
    if (stages.length <= 1) { setError('Cannot delete the only stage'); return }

    const statusKey = stage.name.toLowerCase().replace(/\s+/g, '_')
    const { count } = await createClient()
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('outreach_status', statusKey)

    if (count && count > 0) {
      setError(`Cannot delete "${stage.name}" — ${count} prospect(s) are in this stage. Move them first.`)
      return
    }

    if (!confirm(`Delete stage "${stage.name}"? This cannot be undone.`)) return

    const res = await fetch('/api/settings/pipeline-stages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stage.id }),
    })
    if (res.ok) {
      setStages(prev => prev.filter((_, i) => i !== idx))
      setPendingChanges(false)
    } else {
      const d = await res.json()
      setError(d.error)
    }
  }

  if (loading) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>Loading…</div>

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Pipeline Stages</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {saving && <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>Saving…</span>}
            {saved && !saving && <span style={{ fontSize: 11, color: '#22C55E' }}>✓ Saved</span>}
            <button
              onClick={saveOrder}
              disabled={saving || !pendingChanges}
              style={{ ...S.btn, padding: '6px 16px', fontSize: 12, opacity: pendingChanges ? 1 : 0.4, cursor: pendingChanges ? 'pointer' : 'default' }}
            >
              Save Changes
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 16 }}>
          Drag to reorder. Changes apply to the Kanban immediately.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={e => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                backgroundColor: dragIdx === idx ? 'var(--crm-border)' : 'var(--crm-surface-raised)',
                border: '1px solid var(--crm-border)', borderRadius: 8,
                cursor: 'grab',
                transition: 'background .1s',
              }}
            >
              <GripVertical size={14} color="var(--crm-text-muted)" style={{ flexShrink: 0 }} />
              <input
                type="color"
                value={stage.color}
                onChange={e => updateStage(idx, 'color', e.target.value)}
                style={{ width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                title="Stage color"
              />
              <input
                value={stage.name}
                onChange={e => updateStage(idx, 'name', e.target.value)}
                style={{ flex: 1, backgroundColor: 'transparent', border: 'none', color: 'var(--crm-text-primary)', fontSize: 13, outline: 'none' }}
              />
              <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontFamily: 'monospace' }}>#{idx}</span>
              {!stage.is_default && (
                <button
                  onClick={() => deleteStage(stage, idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 2 }}
                  title="Delete stage"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {stage.is_default && (
                <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', border: '1px solid var(--crm-border)', borderRadius: 3, padding: '1px 5px' }}>default</span>
              )}
            </div>
          ))}
        </div>

        {/* Add stage */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            style={{ width: 32, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0, backgroundColor: 'transparent', flexShrink: 0 }}
          />
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addStage()}
            placeholder="New stage name…"
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={addStage} disabled={adding || !newName.trim()} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Plus size={14} /> Add Stage
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#EF4444', fontSize: 13, backgroundColor: '#3A1A1A', border: '1px solid #EF444430', borderRadius: 7, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}><X size={13} /></button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 3 — Plan & Usage
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
  if (!data) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>No se pudo cargar el plan. Recarga la página.</div>

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
                <div key={sdr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 7 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                    <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginLeft: 8 }}>{sdr.email}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>since {new Date(sdr.created_at).toLocaleDateString()}</span>
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
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 380 }}>
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
function emptySenderProfileForm() {
  return {
    display_name: '', title: '', company: '', style_hint: '', language: 'en', is_default: true,
    linkedin_account_tier: '', connection_note_max_chars: '300', followup_max_chars: '1900',
  }
}

function ScraperTab() {
  const [combos, setCombos] = useState<ScraperComboMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})

  const [sdrs, setSdrs] = useState<User[]>([])
  const [profilesBySdr, setProfilesBySdr] = useState<Record<string, SenderProfile[]>>({})
  const [openFormFor, setOpenFormFor] = useState<string | null>(null)
  const [formFields, setFormFields] = useState(emptySenderProfileForm())
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
      .eq('scraper_access', true)
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
        body: JSON.stringify({
          ...formFields,
          user_id: sdrId,
          linkedin_account_tier: formFields.linkedin_account_tier || null,
          connection_note_max_chars: Number(formFields.connection_note_max_chars) || 300,
          followup_max_chars: Number(formFields.followup_max_chars) || 1900,
        }),
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
      setFormFields(emptySenderProfileForm())
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--crm-surface-raised)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      onClick={() => { setOpenFormFor(isOpen ? null : sdr.id); setProfileError(null); setFormFields(emptySenderProfileForm()) }}
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
                          <div style={{ flex: 1 }}>
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
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
                          <select value={formFields.language} onChange={e => setFormFields(p => ({ ...p, language: e.target.value }))} style={S.select}>
                            <option value="en">English</option>
                            <option value="zh">中文</option>
                            <option value="es">Español</option>
                            <option value="vi">Tiếng Việt</option>
                          </select>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={S.label}>Style hint (optional)</label>
                          <input value={formFields.style_hint} onChange={e => setFormFields(p => ({ ...p, style_hint: e.target.value }))} placeholder="Professional, concise, focuses on ROI..." style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>LinkedIn Account Tier</label>
                          <select value={formFields.linkedin_account_tier} onChange={e => setFormFields(p => ({ ...p, linkedin_account_tier: e.target.value }))} style={S.select}>
                            <option value="">—</option>
                            <option value="free">Free</option>
                            <option value="premium">Premium</option>
                            <option value="sales_navigator">Sales Navigator</option>
                            <option value="recruiter">Recruiter</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.label}>Connection Note Max Chars</label>
                          <input type="number" value={formFields.connection_note_max_chars} onChange={e => setFormFields(p => ({ ...p, connection_note_max_chars: e.target.value }))} style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>Follow-up Max Chars</label>
                          <input type="number" value={formFields.followup_max_chars} onChange={e => setFormFields(p => ({ ...p, followup_max_chars: e.target.value }))} style={S.input} />
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
// Tab 5 — BD Group
// ────────────────────────────────────────────────────────────────────────────
function emptySeedListForm() {
  return { list_name: '', market: '', company_names: [] as string[], title_keywords: [] as string[], seniority_levels: [] as string[], channel_family: '' }
}

function SeedListsSection({ channelFamilies }: { channelFamilies: ChannelFamilyType[] }) {
  const [lists, setLists] = useState<OrgCompanySeedList[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptySeedListForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/seed-lists')
      .then(r => r.json())
      .then((d: OrgCompanySeedList[]) => { setLists(d); setLoading(false) })
  }, [])

  function openCreate() {
    setForm(emptySeedListForm())
    setEditingId(null)
    setOpen(true)
    setError(null)
  }

  function openEdit(sl: OrgCompanySeedList) {
    setForm({
      list_name: sl.list_name,
      market: sl.market ?? '',
      company_names: sl.company_names,
      title_keywords: sl.title_keywords,
      seniority_levels: sl.seniority_levels,
      channel_family: sl.channel_family ?? '',
    })
    setEditingId(sl.id)
    setOpen(true)
    setError(null)
  }

  async function save() {
    if (!form.list_name.trim()) { setError('List name is required'); return }
    setSaving(true); setError(null)
    const payload = {
      list_name: form.list_name.trim(),
      market: form.market || null,
      company_names: form.company_names,
      title_keywords: form.title_keywords,
      seniority_levels: form.seniority_levels,
      channel_family: form.channel_family || null,
    }
    const res = editingId
      ? await fetch(`/api/settings/seed-lists/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/settings/seed-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }
    setLists(prev => editingId ? prev.map(l => l.id === editingId ? data : l) : [...prev, data])
    setOpen(false)
    setSaving(false)
  }

  async function remove(sl: OrgCompanySeedList) {
    if (!confirm(`Delete seed list "${sl.list_name}"?`)) return
    const res = await fetch(`/api/settings/seed-lists/${sl.id}`, { method: 'DELETE' })
    if (res.ok) setLists(prev => prev.filter(l => l.id !== sl.id))
  }

  if (loading) return <div style={S.card}><p style={{ color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p></div>

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Seed Lists</p>
        <button onClick={openCreate} style={{ ...S.btn, padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Plus size={12} /> Add Seed List
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
        Companies to search under for BD channel scraping. A run can cover more than one list.
      </p>

      {lists.length === 0 && !open ? (
        <p style={{ fontSize: 13, color: 'var(--crm-text-muted)' }}>No seed lists yet.</p>
      ) : lists.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: open ? 16 : 0 }}>
          {lists.map(sl => (
            <div key={sl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8, border: '1px solid var(--crm-border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{sl.list_name}</span>
                  {sl.market && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-muted)' }}>{sl.market}</span>}
                </div>
                <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '4px 0 0' }}>
                  {sl.company_names.length} companies · {sl.title_keywords.length} title keywords
                  {sl.channel_family && ` · ${channelFamilies.find(f => f.code === sl.channel_family)?.label ?? sl.channel_family}`}
                </p>
              </div>
              <button onClick={() => openEdit(sl)} style={{ ...S.btnGhost, fontSize: 12, padding: '5px 12px' }}>Edit</button>
              <button onClick={() => remove(sl)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div style={{ padding: '14px 16px', borderRadius: 8, border: '1px solid var(--crm-border)', backgroundColor: '#6C63FF06' }}>
          {error && <p style={{ fontSize: 12, color: '#EF4444', margin: '0 0 10px' }}>{error}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={S.label}>List Name *</label>
              <input value={form.list_name} onChange={e => setForm(f => ({ ...f, list_name: e.target.value }))} placeholder="Q3 LATAM Telecoms" style={S.input} />
            </div>
            <div>
              <label style={S.label}>Market</label>
              <select value={form.market} onChange={e => setForm(f => ({ ...f, market: e.target.value }))} style={S.select}>
                <option value="">—</option>
                {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={S.label}>Channel Family</label>
              <select value={form.channel_family} onChange={e => setForm(f => ({ ...f, channel_family: e.target.value }))} style={S.select}>
                <option value="">—</option>
                {channelFamilies.map(cf => <option key={cf.code} value={cf.code}>{cf.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={S.label}>Company Names</label>
              <TagInput value={form.company_names} onChange={v => setForm(f => ({ ...f, company_names: v }))} placeholder="Type a company name and press Enter…" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={S.label}>Title Keywords</label>
              <TagInput value={form.title_keywords} onChange={v => setForm(f => ({ ...f, title_keywords: v }))} placeholder="e.g. VP Partnerships…" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={S.label}>Seniority Levels</label>
              <TagInput value={form.seniority_levels} onChange={v => setForm(f => ({ ...f, seniority_levels: v }))} placeholder="e.g. Director, VP…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={save} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Seed List'}</button>
            <button onClick={() => setOpen(false)} style={S.btnGhost}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function IcpKeywordsSection() {
  const [keywords, setKeywords] = useState<OrgIcpKeyword[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, { keyword: string; weight: string }>>({})
  const [adding, setAdding] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/icp-keywords')
      .then(r => r.json())
      .then((d: OrgIcpKeyword[]) => { setKeywords(d); setLoading(false) })
  }, [])

  function draftFor(cat: string) {
    return drafts[cat] ?? { keyword: '', weight: '1' }
  }
  function setDraft(cat: string, patch: Partial<{ keyword: string; weight: string }>) {
    setDrafts(prev => ({ ...prev, [cat]: { ...draftFor(cat), ...patch } }))
  }

  async function addKeyword(cat: string) {
    const d = draftFor(cat)
    if (!d.keyword.trim()) return
    setAdding(p => ({ ...p, [cat]: true }))
    try {
      const res = await fetch('/api/settings/icp-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat, keyword: d.keyword.trim(), weight: Number(d.weight) || 1 }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to add keyword'); return }
      setKeywords(prev => [...prev, data])
      setDrafts(prev => ({ ...prev, [cat]: { keyword: '', weight: '1' } }))
    } finally {
      setAdding(p => ({ ...p, [cat]: false }))
    }
  }

  async function updateWeight(kw: OrgIcpKeyword, weight: number) {
    setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, weight } : k))
    await fetch(`/api/settings/icp-keywords/${kw.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight }),
    })
  }

  async function removeKeyword(kw: OrgIcpKeyword) {
    setKeywords(prev => prev.filter(k => k.id !== kw.id))
    await fetch(`/api/settings/icp-keywords/${kw.id}`, { method: 'DELETE' })
  }

  if (loading) return <div style={S.card}><p style={{ color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p></div>

  return (
    <div style={S.card}>
      <p style={S.sectionTitle}>ICP Keywords</p>
      <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
        Scoring signal keywords, grouped by category, each with a weight.
      </p>
      {error && (
        <div style={{ color: '#EF4444', fontSize: 13, backgroundColor: '#3A1A1A', border: '1px solid #EF444430', borderRadius: 7, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}><X size={13} /></button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {ICP_CATEGORIES.map(cat => {
          const rows = keywords.filter(k => k.category === cat)
          const d = draftFor(cat)
          return (
            <div key={cat}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--crm-text-secondary)', marginBottom: 8 }}>{ICP_CATEGORY_LABELS[cat]}</p>
              {rows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {rows.map(kw => (
                    <div key={kw.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 6 }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--crm-text-primary)' }}>{kw.keyword}</span>
                      <input
                        type="number"
                        value={kw.weight}
                        onChange={e => updateWeight(kw, Number(e.target.value))}
                        style={{ width: 60, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface)', color: 'var(--crm-text-primary)', fontSize: 12, textAlign: 'center' }}
                      />
                      <button onClick={() => removeKeyword(kw)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 2 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={d.keyword}
                  onChange={e => setDraft(cat, { keyword: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && addKeyword(cat)}
                  placeholder="Add keyword…"
                  style={{ ...S.input, flex: 1 }}
                />
                <input
                  type="number"
                  value={d.weight}
                  onChange={e => setDraft(cat, { weight: e.target.value })}
                  style={{ width: 70, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-primary)', fontSize: 13 }}
                  title="Weight"
                />
                <button onClick={() => addKeyword(cat)} disabled={adding[cat] || !d.keyword.trim()} style={{ ...S.btn, padding: '8px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function emptyHookForm() {
  return { hook_copy: '', decision_maker_titles: [] as string[], partnership_models_offered: [] as string[] }
}

function ChannelHooksSection({ channelFamilies }: { channelFamilies: ChannelFamilyType[] }) {
  const [hooks, setHooks] = useState<OrgChannelHook[]>([])
  const [loading, setLoading] = useState(true)
  const [openFamily, setOpenFamily] = useState<string | null>(null)
  const [form, setForm] = useState(emptyHookForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/channel-hooks')
      .then(r => r.json())
      .then((d: OrgChannelHook[]) => { setHooks(d); setLoading(false) })
  }, [])

  function hookFor(code: string) { return hooks.find(h => h.channel_family === code) }

  function openEdit(code: string) {
    const existing = hookFor(code)
    setForm(existing
      ? { hook_copy: existing.hook_copy ?? '', decision_maker_titles: existing.decision_maker_titles, partnership_models_offered: existing.partnership_models_offered }
      : emptyHookForm())
    setOpenFamily(code)
    setError(null)
  }

  async function save(code: string) {
    setSaving(true); setError(null)
    const res = await fetch('/api/settings/channel-hooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_family: code, ...form }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }
    setHooks(prev => {
      const existing = prev.find(h => h.channel_family === code)
      return existing ? prev.map(h => h.channel_family === code ? data : h) : [...prev, data]
    })
    setOpenFamily(null)
    setSaving(false)
  }

  async function clear(hook: OrgChannelHook) {
    if (!confirm('Clear this channel hook?')) return
    const res = await fetch(`/api/settings/channel-hooks/${hook.id}`, { method: 'DELETE' })
    if (res.ok) setHooks(prev => prev.filter(h => h.id !== hook.id))
  }

  if (loading) return <div style={S.card}><p style={{ color: 'var(--crm-text-muted)', margin: 0 }}>Loading…</p></div>

  return (
    <div style={S.card}>
      <p style={S.sectionTitle}>Channel Hooks</p>
      <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
        Your pitch angle per channel family — used to personalize BD outreach.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {channelFamilies.map(cf => {
          const existing = hookFor(cf.code)
          const isOpen = openFamily === cf.code
          return (
            <div key={cf.code} style={{ border: '1px solid var(--crm-border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--crm-surface-raised)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{cf.label}</span>
                  {existing ? (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: '#22C55E20', color: '#22C55E', fontWeight: 700 }}>Configured</span>
                  ) : (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-muted)', fontWeight: 700 }}>Not configured</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => isOpen ? setOpenFamily(null) : openEdit(cf.code)} style={{ ...S.btnGhost, fontSize: 12, padding: '5px 12px' }}>
                    {isOpen ? 'Close' : existing ? 'Edit' : 'Configure'}
                  </button>
                  {existing && (
                    <button onClick={() => clear(existing)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4 }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div style={{ padding: '14px 16px', backgroundColor: '#6C63FF06' }}>
                  {error && <p style={{ fontSize: 12, color: '#EF4444', margin: '0 0 10px' }}>{error}</p>}
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.label}>Hook Copy</label>
                    <textarea
                      value={form.hook_copy}
                      onChange={e => setForm(f => ({ ...f, hook_copy: e.target.value }))}
                      rows={3}
                      placeholder="Your pitch angle for this channel family…"
                      style={{ ...S.input, resize: 'vertical' as const }}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.label}>Decision-Maker Titles</label>
                    <TagInput value={form.decision_maker_titles} onChange={v => setForm(f => ({ ...f, decision_maker_titles: v }))} placeholder="e.g. VP Partnerships…" />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={S.label}>Partnership Models Offered</label>
                    <TagInput value={form.partnership_models_offered} onChange={v => setForm(f => ({ ...f, partnership_models_offered: v }))} placeholder="e.g. referral, reseller…" />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => save(cf.code)} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                    <button onClick={() => setOpenFamily(null)} style={S.btnGhost}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {channelFamilies.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)' }}>No channel families defined yet.</p>
        )}
      </div>
    </div>
  )
}

function BdGroupTab() {
  const [channelFamilies, setChannelFamilies] = useState<ChannelFamilyType[]>([])

  useEffect(() => {
    createClient()
      .from('channel_family_types')
      .select('*')
      .order('label')
      .then(({ data }) => { if (data) setChannelFamilies(data as ChannelFamilyType[]) })
  }, [])

  return (
    <div>
      <SeedListsSection channelFamilies={channelFamilies} />
      <IcpKeywordsSection />
      <ChannelHooksSection channelFamilies={channelFamilies} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Settings page
// ────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'organization', label: 'Organization' },
  { key: 'pipeline',     label: 'Pipeline' },
  { key: 'plan',         label: 'Plan & Usage' },
  { key: 'scraper',      label: 'Scraper' },
  { key: 'bdgroup',      label: 'BD Group' },
]

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const { user } = useUser()
  const hasBdGroup = useHasAddon('bd_group')

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

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid var(--crm-border)', paddingBottom: 0 }}>
        {TABS.filter(t => t.key !== 'bdgroup' || hasBdGroup).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 18px',
              fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)',
              borderBottom: tab === t.key ? '2px solid var(--crm-accent)' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'organization' && <OrgTab />}
      {tab === 'pipeline'     && <PipelineTab />}
      {tab === 'plan'         && <PlanTab />}
      {tab === 'scraper'      && <ScraperTab />}
      {tab === 'bdgroup'      && (
        <AddonFeature hasAccess={hasBdGroup} featureName="BD Group Settings">
          <BdGroupTab />
        </AddonFeature>
      )}
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
