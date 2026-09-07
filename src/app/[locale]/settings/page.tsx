'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { Plus, Trash2, Pencil, Copy } from 'lucide-react'
import { OrgMarketsSettings } from '@/components/markets/OrgMarketsSettings'
import CustomComboModal from '@/components/scraper/CustomComboModal'
import type { Organization, OrganizationAddon, ScraperComboMaster, User, SenderProfile, Workspace } from '@/lib/types'

const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',
  premium: '#8B5CF6',
  enterprise: '#F59E0B',
  ultra: '#EF4444',
  demo: '#14B8A6',
}

// Whether an add-on has a translated label under `settings.addons.*`.
//
// This used to be a hardcoded Set, which drifted the moment an add-on was
// added without anyone remembering to update it: `bridge` shipped and every
// admin with it saw the raw string "bridge" in all four languages. Asking the
// message catalogue directly can't drift — add the key and the label appears,
// forget it and the raw type still shows as a graceful fallback instead of
// throwing.
function addonLabel(t: ReturnType<typeof useTranslations<'settings'>>, addonType: string) {
  const key = `addons.${addonType}`
  // `has` is typed for literal keys; `addon_type` is a runtime string from the
  // DB, so the cast is the honest way to ask a question the type system can't.
  return (t as unknown as { has(k: string): boolean }).has(key)
    ? (t as unknown as (k: string) => string)(key)
    : addonType
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
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 6, backgroundColor: 'transparent', border: '1px solid var(--crm-border)', color: 'var(--crm-text-secondary)', cursor: 'pointer', padding: 0, flexShrink: 0 },
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
  const t = useTranslations('settings')
  const tc = useTranslations('common')
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
      setLogoError(e instanceof Error ? e.message : t('uploadFailed'))
    } finally {
      setUploadingLogo(false)
    }
  }

  if (!org) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>{tc('loading')}</div>

  return (
    <div>
      <div style={S.card}>
        <p style={S.sectionTitle}>{t('general')}</p>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>{t('orgName')}</label>
          <input value={name} onChange={e => setName(e.target.value)} style={S.input} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>{t('logo')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={t('logo')} style={{ height: 44, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)' }} />
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
                {uploadingLogo ? t('uploading') : logoUrl ? t('changeLogo') : t('uploadLogo')}
              </button>
              {logoError && <p style={{ fontSize: 12, color: '#EF4444', margin: '4px 0 0' }}>{logoError}</p>}
            </div>
          </div>
        </div>
      </div>

      <OrgMarketsSettings />

      <div style={S.card}>
        <p style={S.sectionTitle}>{t('companyContext')}</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          {t('companyContextDesc')}
        </p>
        <textarea
          value={companyContext}
          onChange={e => setCompanyContext(e.target.value)}
          rows={8}
          placeholder={t('companyContextPlaceholder')}
          style={{ ...S.input, resize: 'vertical', minHeight: 140, lineHeight: 1.6 }}
        />
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t('bridgeContext')}</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          {t('bridgeContextDesc')}
        </p>
        <textarea
          value={bridgeContext}
          onChange={e => setBridgeContext(e.target.value)}
          rows={8}
          placeholder={t('bridgeContextPlaceholder')}
          style={{ ...S.input, resize: 'vertical', minHeight: 140, lineHeight: 1.6 }}
        />
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t('domainBlacklist')}</p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>
          {t('domainBlacklistDesc')}
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
        {saving ? t('saving') : saved ? `✓ ${tc('saved')}` : t('saveChanges')}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 2 — Plan & Usage
// ────────────────────────────────────────────────────────────────────────────
// Sites (workspaces)
// ────────────────────────────────────────────────────────────────────────────
type WorkspaceRow = Workspace & { member_count: number }

/**
 * Manage the org's sites — branch offices, each with its own people and leads.
 *
 * Renders NOTHING at all unless the org has the `multi_workspace` add-on. An
 * org that will never buy it should not learn the feature exists from an empty
 * panel it can't use; the API enforces the same gate independently, since UI
 * gating is never the security boundary.
 *
 * Read-only for a site admin (someone whose own `workspace_id` is set). They
 * can see the layout of the org they work in, but letting them create a site
 * and move into it would defeat the partition confining them.
 */
function WorkspacesSection() {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const [rows, setRows] = useState<WorkspaceRow[]>([])
  const [addonActive, setAddonActive] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = async () => {
    try {
      const res = await fetch('/api/workspaces')
      if (!res.ok) { setLoaded(true); return }
      const d = await res.json()
      setRows(d.workspaces ?? [])
      setAddonActive(!!d.addon_active)
      setCanManage(!!d.can_manage)
    } catch { /* leave hidden */ } finally { setLoaded(true) }
  }

  useEffect(() => { load() }, [])

  // Every mutation reloads instead of patching local state: `member_count` is
  // computed server-side and a rename can collide, so the server's answer is
  // the only trustworthy view of what actually happened.
  const call = async (method: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? tc('error')); return false }
      await load()
      return true
    } catch { setError(tc('error')); return false } finally { setBusy(false) }
  }

  if (!loaded || !addonActive) return null

  return (
    <div style={S.card}>
      <p style={{ ...S.sectionTitle, marginBottom: 6 }}>{t('sites')}</p>
      <p style={{ fontSize: 12.5, color: 'var(--crm-text-muted)', margin: '0 0 16px' }}>
        {t('sitesHelp')}
      </p>

      {error && (
        <div style={{ padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12.5,
                      background: '#EF444415', border: '1px solid #EF444440', color: '#EF4444' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: canManage ? 16 : 0 }}>
        {rows.map(w => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 8,
                                   padding: '10px 14px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8 }}>
            {editingId === w.id ? (
              <>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={{ ...S.input, flex: 1, minWidth: 0, width: 'auto' }}
                  autoFocus
                />
                <button
                  disabled={busy}
                  onClick={async () => { if (await call('PATCH', { id: w.id, name: editName })) setEditingId(null) }}
                  style={{ ...S.btn, padding: '6px 14px' }}
                >{tc('save')}</button>
                <button onClick={() => setEditingId(null)} style={{ ...S.btnGhost, padding: '6px 12px' }}>
                  {tc('cancel')}
                </button>
              </>
            ) : (
              <>
                {/* minWidth:0 so a long site name ellipsizes instead of pushing
                    the member count and buttons off a narrow screen. */}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500,
                               color: w.is_active ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)' }}>
                  {w.name}
                  {!w.is_active && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--crm-text-muted)',
                                   border: '1px solid var(--crm-border)', borderRadius: 3, padding: '1px 6px' }}>
                      {t('siteInactive')}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {t('siteMembers', { count: w.member_count })}
                </span>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => { setEditingId(w.id); setEditName(w.name) }}
                      style={{ ...S.btnGhost, padding: '5px 11px', fontSize: 12 }}
                    >{tc('edit')}</button>
                    <button
                      disabled={busy}
                      onClick={() => call('PATCH', { id: w.id, is_active: !w.is_active })}
                      style={{ ...S.btnGhost, padding: '5px 11px', fontSize: 12 }}
                    >{w.is_active ? t('siteDeactivate') : t('siteActivate')}</button>
                    <button
                      disabled={busy}
                      onClick={() => call('DELETE', { id: w.id })}
                      style={{ ...S.btnGhost, padding: '5px 11px', fontSize: 12, color: '#EF4444', borderColor: '#EF444440' }}
                    >{tc('delete')}</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', rowGap: 8 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('sitePlaceholder')}
            style={{ ...S.input, flex: 1, minWidth: 180, width: 'auto' }}
          />
          <button
            disabled={busy || !newName.trim()}
            onClick={async () => { if (await call('POST', { name: newName })) setNewName('') }}
            style={{ ...S.btn, opacity: busy || !newName.trim() ? 0.5 : 1 }}
          >{t('siteAdd')}</button>
        </div>
      )}
    </div>
  )
}

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
  const t = useTranslations('settings')
  const tc = useTranslations('common')
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

  if (loading) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>{tc('loading')}</div>
  if (!data) return <div style={{ color: 'var(--crm-text-muted)', padding: 40, textAlign: 'center' }}>{t('planLoadError')}</div>

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
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>{t('currentPlan')}</p>
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
                ? `$${org.custom_price.toLocaleString()}${t('perMonth')}`
                : org.plan === 'ultra' ? t('pricingInternal')
                // Without this branch a trial fell through to the final `else`
                // and told the prospect they were paying $550 a month.
                : org.plan === 'demo' ? t('pricingTrial')
                : org.plan === 'enterprise' ? t('pricingCustom')
                : org.plan === 'premium' ? `$2,300${t('perMonth')}`
                : `$550${t('perMonth')}`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
              {t('billingPeriod', { from: periodDate.toLocaleDateString(), to: nextPeriod.toLocaleDateString() })}
            </div>
          </div>
        </div>
      </div>

      {/* Seats */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>{t('seats')}</p>
          {seatsAtLimit ? (
            <button onClick={() => setShowBuySeats(true)} style={{ ...S.btn, padding: '6px 14px', fontSize: 12 }}>{t('buyMoreSeats')}</button>
          ) : org.plan === 'basic' ? (
            <button onClick={() => router.push(`/${locale}/settings?tab=plan`)} style={{ ...S.btnGhost, fontSize: 12 }}>{t('upgradeToPremium')}</button>
          ) : null}
        </div>

        {seatsUnlimited ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{t('unlimitedSeats')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{t('seatsUsed', { used: sdrCount, max: maxSeats })}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: seatsAtLimit ? '#EF4444' : '#22C55E' }}>
                {t('remaining', { count: maxSeats - sdrCount })}
              </span>
            </div>
            <Bar value={sdrCount} max={maxSeats} color={seatsAtLimit ? '#EF4444' : 'var(--crm-accent)'} />
          </>
        )}

        {sdrs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{t('activeSdrs')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sdrs.map(sdr => (
                <div key={sdr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 7 }}>
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--crm-text-primary)' }}>{sdr.full_name}</span>
                    <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginLeft: 8 }}>{sdr.email}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', flexShrink: 0 }}>{t('memberSince', { date: new Date(sdr.created_at).toLocaleDateString() })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Leads this period */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>{t('leadsThisPeriod')}</p>
          {leadsAtLimit && (
            <button onClick={() => alert(t('buyMoreLeadsAlert'))} style={{ ...S.btn, padding: '6px 14px', fontSize: 12 }}>{t('buyMoreLeads')}</button>
          )}
        </div>

        {leadsUnlimited ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{t('unlimitedLeads')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{t('leadsUsed', { used: leadsCount.toLocaleString(), max: maxLeads.toLocaleString() })}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: leadsAtLimit ? '#EF4444' : '#22C55E' }}>
                {t('remaining', { count: Math.max(0, maxLeads - leadsCount).toLocaleString() })}
              </span>
            </div>
            <Bar value={leadsCount} max={maxLeads} color={leadsAtLimit ? '#EF4444' : 'var(--crm-accent)'} />
          </>
        )}
        <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 10 }}>
          {t('leadsResetNote', { date: nextPeriod.toLocaleDateString() })}
        </p>
      </div>

      {/* Add-ons */}
      <div style={S.card}>
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>{t('activeAddons')}</p>
        {addons.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)' }}>{t('noAddons')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {addons.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--crm-text-primary)' }}>{addonLabel(t, a.addon_type)}</span>
                  <span style={{ display: 'inline-block', marginLeft: 10, fontSize: 10, backgroundColor: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E30', borderRadius: 3, padding: '1px 6px' }}>{t('active')}</span>
                </div>
                {a.price_monthly && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)' }}>${a.price_monthly}{t('perMonth')}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <WorkspacesSection />

      {/* Buy Seats modal */}
      {showBuySeats && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 380, maxWidth: '90vw', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{t('buyMoreSeats')}</h3>
            <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 20 }}>
              {t('buySeatsBody')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <a href="mailto:placeholder@aitokenking.com?subject=Add+more+seats" style={{ ...S.btn, flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                {t('contactUs')}
              </a>
              <button onClick={() => setShowBuySeats(false)} style={{ ...S.btnGhost, flex: 1 }}>{tc('close')}</button>
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
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const [combos, setCombos] = useState<ScraperComboMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})
  // null = closed. `seed` is the row being edited, or the global combo being
  // copied; `duplicating` is what tells those two apart at save time.
  const [comboModal, setComboModal] = useState<{ seed: ScraperComboMaster | null; duplicating: boolean } | null>(null)
  const [comboError, setComboError] = useState<string | null>(null)

  const [sdrs, setSdrs] = useState<User[]>([])
  const [profilesBySdr, setProfilesBySdr] = useState<Record<string, SenderProfile[]>>({})
  const [openFormFor, setOpenFormFor] = useState<string | null>(null)
  // null = the open form is creating a new profile; an id = editing that one.
  // Until this existed the only way to change a profile was delete-and-recreate,
  // and since the row showed just name/title/company you couldn't see what the
  // language or style hint had been before overwriting it — you were editing
  // blind, on the exact fields that drive message personalisation.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
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
      setProfileError(t('profileFieldsRequired'))
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
      if (!res.ok) { setProfileError(data.error ?? t('profileCreateFailed')); return }
      setProfilesBySdr(prev => {
        const existing = prev[sdrId] ?? []
        const updated = formFields.is_default
          ? existing.map(p => ({ ...p, is_default: false }))
          : existing
        return { ...prev, [sdrId]: [...updated, data] }
      })
      closeProfileForm()
    } catch { setProfileError(t('networkError')) } finally { setSavingProfile(false) }
  }

  // Open the form pre-filled with an existing profile. `language` is stored as
  // NULL when the SDR never picked one (that's what tells the backend to fall
  // back to the market's language), and the <select> needs '' for that, so the
  // null has to be coalesced here — not defaulted to 'en', which would silently
  // turn "automatic" into an explicit English choice on every save.
  function startEditProfile(sdrId: string, p: SenderProfile) {
    setOpenFormFor(sdrId)
    setEditingProfileId(p.id)
    setProfileError(null)
    setFormFields({
      display_name: p.display_name ?? '',
      title: p.title ?? '',
      company: p.company ?? '',
      style_hint: p.style_hint ?? '',
      language: p.language ?? '',
      is_default: p.is_default,
    })
  }

  function closeProfileForm() {
    setOpenFormFor(null)
    setEditingProfileId(null)
    setProfileError(null)
    setFormFields({ display_name: '', title: '', company: '', style_hint: '', language: '', is_default: true })
  }

  async function updateProfile(sdrId: string, profileId: string) {
    if (!formFields.display_name || !formFields.title || !formFields.company) {
      setProfileError(t('profileFieldsRequired'))
      return
    }
    setSavingProfile(true); setProfileError(null)
    try {
      const res = await fetch(`/api/sender-profiles/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formFields),
      })
      const data = await res.json()
      if (!res.ok) { setProfileError(data.error ?? t('profileSaveFailed')); return }
      setProfilesBySdr(prev => {
        const existing = prev[sdrId] ?? []
        return {
          ...prev,
          // Promoting this one to default demotes the others locally, mirroring
          // what the API does server-side — otherwise the UI would briefly show
          // two DEFAULT badges until the next reload.
          [sdrId]: existing.map(p =>
            p.id === profileId
              ? { ...p, ...data }
              : formFields.is_default ? { ...p, is_default: false } : p
          ),
        }
      })
      closeProfileForm()
    } catch { setProfileError(t('networkError')) } finally { setSavingProfile(false) }
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

  // A saved combo is either new (append) or an edit of one already listed
  // (replace in place, so it doesn't jump to the bottom of the list).
  function onComboSaved(saved: ScraperComboMaster & { org_active?: boolean }) {
    setCombos(prev => {
      const i = prev.findIndex(c => c.code === saved.code)
      if (i === -1) return [...prev, { ...saved, org_active: saved.org_active ?? true }]
      const next = [...prev]
      next[i] = { ...next[i], ...saved }
      return next
    })
    setComboModal(null)
  }

  async function deleteCombo(c: ScraperComboMaster) {
    if (!confirm(t('deleteComboConfirm', { name: c.name }))) return
    setToggling(p => ({ ...p, [c.code]: true }))
    setComboError(null)
    try {
      const res = await fetch(`/api/scraper-combos?code=${encodeURIComponent(c.code)}`, { method: 'DELETE' })
      if (res.ok) setCombos(prev => prev.filter(x => x.code !== c.code))
      else setComboError((await res.json())?.error ?? tc('error'))
    } catch { setComboError(tc('error')) }
    finally { setToggling(p => ({ ...p, [c.code]: false })) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--crm-text-muted)' }}>{tc('loading')}</div>

  const activeCount = combos.filter(c => c.org_active).length

  return (
    <div>
      {/* Sender Profiles — only shown when there are SDRs with scraper access */}
      {sdrs.length > 0 && (
        <div style={S.card}>
          <p style={S.sectionTitle}>{t('senderProfiles')}</p>
          <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 16, marginTop: 0 }}>
            {t('senderProfilesDesc')}
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
                          {t('noDefaultProfile')}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { if (isOpen && !editingProfileId) { closeProfileForm() } else { closeProfileForm(); setOpenFormFor(sdr.id) } }}
                      style={{ ...S.btn, padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Plus size={12} /> {t('addProfile')}
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
                              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', fontWeight: 700, textTransform: 'uppercase' }}>{t('defaultBadge')}</span>
                            ) : (
                              <button
                                onClick={() => setDefault(sdr.id, p.id)}
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-muted)', cursor: 'pointer' }}
                              >
                                {t('setDefault')}
                              </button>
                            )}
                            <button
                              onClick={() => startEditProfile(sdr.id, p)}
                              title={t('editProfile')}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: editingProfileId === p.id ? 'var(--crm-accent)' : 'var(--crm-text-muted)', display: 'flex', padding: 4 }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteProfile(sdr.id, p.id)}
                              title={t('deleteProfile')}
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
                      {/* The form renders at the bottom of the SDR card, far from the
                          row you clicked, so it has to say which profile it is acting
                          on — otherwise with several profiles you can't tell whether
                          you're editing one or adding another. */}
                      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--crm-text-muted)', margin: '0 0 10px', textTransform: 'uppercase' }}>
                        {editingProfileId
                          ? t('editingProfile', { name: (profiles.find(p => p.id === editingProfileId)?.display_name) ?? t('profileFallbackName') })
                          : t('newProfile')}
                      </p>
                      {profileError && <p style={{ fontSize: 12, color: '#EF4444', margin: '0 0 10px' }}>{profileError}</p>}
                      <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={S.label}>{t('displayName')} *</label>
                          <input value={formFields.display_name} onChange={e => setFormFields(p => ({ ...p, display_name: e.target.value }))} placeholder="John D." style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>{t('profileTitle')} *</label>
                          <input value={formFields.title} onChange={e => setFormFields(p => ({ ...p, title: e.target.value }))} placeholder={t('profileTitlePlaceholder')} style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>{t('profileCompany')} *</label>
                          <input value={formFields.company} onChange={e => setFormFields(p => ({ ...p, company: e.target.value }))} placeholder="AITokenKing" style={S.input} />
                        </div>
                        <div>
                          <label style={S.label}>{t('language')}</label>
                          {/* Codes must match the scraper's _language_instruction()
                              map (linkedin-scraper/api/message_generator.py).
                              Bare "zh" used to be the only Chinese option and the
                              backend resolves it to SIMPLIFIED — so picking it for a
                              Taiwan or Hong Kong SDR silently produced the wrong
                              script, with no way to ask for Traditional at all.
                              Portuguese was missing entirely even though Brazil and
                              Portugal are both configured as 'pt' in `markets`. */}
                          <select value={formFields.language} onChange={e => setFormFields(p => ({ ...p, language: e.target.value }))} style={S.select}>
                            <option value="">{t('languageAutomatic')}</option>
                            <option value="en">English</option>
                            <option value="zh-TW">繁體中文 (Traditional)</option>
                            <option value="zh-CN">简体中文 (Simplified)</option>
                            <option value="es">Español</option>
                            <option value="pt">Português</option>
                            <option value="vi">Tiếng Việt</option>
                          </select>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={S.label}>{t('styleHint')}</label>
                          <input value={formFields.style_hint} onChange={e => setFormFields(p => ({ ...p, style_hint: e.target.value }))} placeholder={t('styleHintPlaceholder')} style={S.input} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--crm-text-secondary)' }}>
                          <input type="checkbox" checked={formFields.is_default} onChange={e => setFormFields(p => ({ ...p, is_default: e.target.checked }))} style={{ accentColor: 'var(--crm-accent)' }} />
                          {t('setAsDefault')}
                        </label>
                        <button
                          onClick={() => editingProfileId ? updateProfile(sdr.id, editingProfileId) : createProfile(sdr.id)}
                          disabled={savingProfile}
                          style={{ ...S.btn, opacity: savingProfile ? 0.6 : 1 }}
                        >
                          {savingProfile ? t('saving') : editingProfileId ? t('saveChanges') : t('createProfile')}
                        </button>
                        <button onClick={closeProfileForm} style={S.btnGhost}>{tc('cancel')}</button>
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
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', rowGap: 8,
        }}>
          <p style={S.sectionTitle}>{t('searchCombos')}</p>
          <button
            onClick={() => { setComboError(null); setComboModal({ seed: null, duplicating: false }) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none',
              borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> {t('newCombo')}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', marginBottom: 8, marginTop: 0 }}>
          {t('searchCombosDesc')} {activeCount > 0 && t('combosActiveCount', { count: activeCount })}
        </p>
        <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 16, marginTop: 0 }}>
          {t('customCombosDesc')}
        </p>
        {comboError && (
          <div style={{
            fontSize: 12, color: '#F87171', backgroundColor: '#F8717115',
            border: '1px solid #F8717140', borderRadius: 7, padding: '8px 12px', marginBottom: 14,
          }}>
            {comboError}
          </div>
        )}
        {combos.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>{t('noCombos')}</p>
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
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', fontWeight: 700, textTransform: 'uppercase' }}>
                        {t('active')}
                      </span>
                    )}
                    {c.organization_id && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: '#22C55E20', color: '#22C55E', fontWeight: 700, textTransform: 'uppercase' }}>
                        {t('yourCombo')}
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
                          {t('moreKeywords', { count: c.title_keywords.length - 5 })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {c.organization_id ? (
                    <>
                      <button
                        onClick={() => { setComboError(null); setComboModal({ seed: c, duplicating: false }) }}
                        title={tc('edit')}
                        style={S.iconBtn}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteCombo(c)}
                        disabled={toggling[c.code]}
                        title={tc('delete')}
                        style={{ ...S.iconBtn, color: '#F87171' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    // A catalogue combo can't be edited — it is shared with every
                    // other customer — but it can be copied into this org and then
                    // changed freely, which is what an admin almost always wants
                    // when ours is close but not quite right.
                    <button
                      onClick={() => { setComboError(null); setComboModal({ seed: c, duplicating: true }) }}
                      title={t('catalogueComboNote')}
                      style={S.iconBtn}
                    >
                      <Copy size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => toggle(c.code, !!c.org_active)}
                    disabled={toggling[c.code]}
                    style={{
                      padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: toggling[c.code] ? 'default' : 'pointer', border: 'none',
                      backgroundColor: c.org_active ? '#22C55E20' : 'var(--crm-border)',
                      color: c.org_active ? '#22C55E' : 'var(--crm-text-muted)',
                      transition: 'all .15s',
                    }}
                  >
                    {c.org_active ? `● ${t('enabled')}` : `○ ${t('disabled')}`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {comboModal && (
        <CustomComboModal
          seed={comboModal.seed}
          duplicating={comboModal.duplicating}
          onClose={() => setComboModal(null)}
          onSaved={onComboSaved}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main Settings page
// ────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'organization', labelKey: 'tabOrganization' },
  { key: 'plan',         labelKey: 'tabPlan' },
  { key: 'scraper',      labelKey: 'tabScraper' },
]

function SettingsContent() {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const { user } = useUser()

  const tab = searchParams.get('tab') ?? 'organization'

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>{tc('loading')}</div>
  }

  if (user.role !== 'admin') {
    return (
      <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>
        <p style={{ fontSize: 15 }}>{t('adminOnly')}</p>
      </div>
    )
  }

  function setTab(key: string) {
    router.replace(`/${locale}/settings?tab=${key}`)
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>{t('title')}</h1>

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
          {TABS.map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 18px',
                fontSize: 13, fontWeight: tab === tb.key ? 600 : 400,
                color: tab === tb.key ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)',
                borderBottom: tab === tb.key ? '2px solid var(--crm-accent)' : '2px solid transparent',
                transition: 'color 0.15s',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {t(tb.labelKey)}
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
  const tc = useTranslations('common')
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>{tc('loading')}</div>}>
      <SettingsContent />
    </Suspense>
  )
}
