'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { GripVertical, Plus, Trash2, X, ChevronDown } from 'lucide-react'
import type { Organization, PipelineStage, OrganizationAddon, SupportTicket } from '@/lib/types'

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

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#6B7280',
}

const S: Record<string, React.CSSProperties> = {
  page:    { padding: '28px 32px', color: '#F0F0F5', maxWidth: 860 },
  card:    { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: 24, marginBottom: 24 },
  label:   { fontSize: 12, fontWeight: 600, color: '#8B8BA0', marginBottom: 6, display: 'block' },
  input:   { width: '100%', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 7, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  select:  { width: '100%', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 7, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  btn:     { backgroundColor: '#6C63FF', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost:{ backgroundColor: 'transparent', color: '#8B8BA0', border: '1px solid #2A2A3A', borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#52526A', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 16 },
}

// ────────────────────────────────────────────────────────────────────────────
// Progress bar helper
// ────────────────────────────────────────────────────────────────────────────
function Bar({ value, max, color = '#6C63FF' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ height: 6, backgroundColor: '#2A2A3A', borderRadius: 3, overflow: 'hidden' }}>
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
      })
  }, [])

  async function save() {
    setSaving(true); setError(null)
    const res = await fetch('/api/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, default_language: language, logo_url: logoUrl || null, domain_blacklist: blacklist || null }),
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

  if (!org) return <div style={{ color: '#52526A', padding: 40, textAlign: 'center' }}>Loading…</div>

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
                <img src={logoUrl} alt="Logo" style={{ height: 44, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: '#1C1C27' }} />
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
        <p style={{ fontSize: 12, color: '#52526A', marginBottom: 12 }}>
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
// Tab 2 — Pipeline
// ────────────────────────────────────────────────────────────────────────────
function PipelineTab() {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6C63FF')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/pipeline-stages')
      .then(r => r.json())
      .then((d: PipelineStage[]) => { setStages(d); setLoading(false) })
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
    saveOrder(stages)
  }

  async function saveOrder(current: PipelineStage[]) {
    setSaving(true)
    const payload = current.map((s, i) => ({ id: s.id, name: s.name, color: s.color, position: i }))
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
    } else {
      setError(data.error)
    }
    setAdding(false)
  }

  async function deleteStage(stage: PipelineStage, idx: number) {
    if (stage.is_default) { setError('Cannot delete default stages'); return }
    const res = await fetch('/api/settings/pipeline-stages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stage.id }),
    })
    if (res.ok) {
      setStages(prev => prev.filter((_, i) => i !== idx))
    } else {
      const d = await res.json()
      setError(d.error)
    }
  }

  if (loading) return <div style={{ color: '#52526A', padding: 40, textAlign: 'center' }}>Loading…</div>

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Pipeline Stages</p>
          {saving && <span style={{ fontSize: 11, color: '#52526A' }}>Saving…</span>}
          {saved && <span style={{ fontSize: 11, color: '#22C55E' }}>✓ Saved</span>}
        </div>
        <p style={{ fontSize: 12, color: '#52526A', marginBottom: 16 }}>
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
                backgroundColor: dragIdx === idx ? '#2A2A3A' : '#1C1C27',
                border: '1px solid #2A2A3A', borderRadius: 8,
                cursor: 'grab',
                transition: 'background .1s',
              }}
            >
              <GripVertical size={14} color="#52526A" style={{ flexShrink: 0 }} />
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
                onBlur={() => saveOrder(stages)}
                style={{ flex: 1, backgroundColor: 'transparent', border: 'none', color: '#F0F0F5', fontSize: 13, outline: 'none' }}
              />
              <span style={{ fontSize: 11, color: '#52526A', fontFamily: 'monospace' }}>#{idx}</span>
              {!stage.is_default && (
                <button
                  onClick={() => deleteStage(stage, idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A', padding: 2 }}
                  title="Delete stage"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {stage.is_default && (
                <span style={{ fontSize: 10, color: '#52526A', border: '1px solid #2A2A3A', borderRadius: 3, padding: '1px 5px' }}>default</span>
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
// Tab 3 — Support
// ────────────────────────────────────────────────────────────────────────────
interface TicketWithMsgCount extends SupportTicket { messages?: { id: string }[] }

function SupportTab({ orgPlan }: { orgPlan: string }) {
  const [tickets, setTickets] = useState<TicketWithMsgCount[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPremiumPlus = orgPlan === 'premium' || orgPlan === 'enterprise' || orgPlan === 'ultra'

  useEffect(() => {
    fetch('/api/settings/tickets')
      .then(r => r.json())
      .then((d: TicketWithMsgCount[]) => { setTickets(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  async function createTicket() {
    if (!subject.trim() || !description.trim()) return
    setCreating(true); setError(null)
    const res = await fetch('/api/settings/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, description, priority }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setCreating(false); return }
    setTickets(prev => [data, ...prev])
    setSubject(''); setDescription(''); setPriority('medium')
    setShowNew(false); setCreating(false)
  }

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress')

  return (
    <div>
      {/* Open Tickets */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ ...S.sectionTitle, marginBottom: 0 }}>Open Tickets</p>
          <button onClick={() => setShowNew(true)} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}>
            <Plus size={13} /> New Ticket
          </button>
        </div>

        {loading && <div style={{ color: '#52526A', textAlign: 'center', padding: 24 }}>Loading…</div>}

        {!loading && openTickets.length === 0 && (
          <div style={{ color: '#52526A', textAlign: 'center', padding: 32, fontSize: 13 }}>
            No open tickets. Everything is good! 🎉
          </div>
        )}

        {!loading && openTickets.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Subject', 'Priority', 'Status', 'Created', 'Replies'].map(col => (
                  <th key={col} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2A2A3A' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {openTickets.map(t => (
                <tr key={t.id}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', fontSize: 13, color: '#F0F0F5', fontWeight: 500 }}>{t.subject}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ backgroundColor: (PRIORITY_COLORS[t.priority] ?? '#6B7280') + '22', color: PRIORITY_COLORS[t.priority] ?? '#6B7280', border: `1px solid ${PRIORITY_COLORS[t.priority] ?? '#6B7280'}44`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                      {t.priority}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#8B8BA0' }}>{t.status.replace('_', ' ')}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#52526A' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: '#52526A' }}>{t.messages?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Account Management */}
      <div style={S.card}>
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>Account Management</p>

        {isPremiumPlus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#6C63FF20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5' }}>AITokenKing</div>
              <div style={{ fontSize: 12, color: '#52526A' }}>Your dedicated account manager</div>
              <div style={{ fontSize: 12, color: '#52526A' }}>Contact details coming soon</div>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
            {/* Blurred preview */}
            <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#6C63FF20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5' }}>████████ ███████</div>
                <div style={{ fontSize: 12, color: '#52526A' }}>Dedicated account manager</div>
                <div style={{ fontSize: 12, color: '#6C63FF' }}>████████@████████.com</div>
              </div>
            </div>
            {/* Overlay */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(10,10,26,0.7)', borderRadius: 8, padding: '12px 16px' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F0F0F5', margin: '0 0 4px' }}>Account Management</p>
                <p style={{ fontSize: 12, color: '#8B8BA0', margin: 0 }}>Add Account Management ($149/mo)</p>
              </div>
              <button style={{ ...S.btn, padding: '7px 16px', fontSize: 12 }}
                onClick={() => alert('Contact your account manager to add Account Management')}>
                Upgrade
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Ticket Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 28, width: 480, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Support Ticket</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}><X size={16} /></button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Subject *</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} style={S.input} placeholder="Brief description of the issue" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Description *</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...S.input, resize: 'vertical' }} placeholder="Describe the issue in detail…" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)} style={S.select}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            {error && <p style={{ color: '#EF4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={createTicket} disabled={creating || !subject.trim() || !description.trim()} style={{ ...S.btn, flex: 1, opacity: creating ? 0.6 : 1 }}>
                {creating ? 'Creating…' : 'Create Ticket'}
              </button>
              <button onClick={() => setShowNew(false)} style={{ ...S.btnGhost, flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab 4 — Plan & Usage
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

  if (loading) return <div style={{ color: '#52526A', padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!data) return <div style={{ color: '#52526A', padding: 40, textAlign: 'center' }}>No se pudo cargar el plan. Recarga la página.</div>

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
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F0F0F5' }}>
              {org.plan === 'enterprise' && org.custom_price
                ? `$${org.custom_price.toLocaleString()}/mo`
                : org.plan === 'ultra' ? 'Internal'
                : org.plan === 'enterprise' ? 'Custom pricing'
                : org.plan === 'premium' ? '$2,300/mo'
                : '$550/mo'}
            </div>
            <div style={{ fontSize: 12, color: '#52526A' }}>
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
          <p style={{ fontSize: 13, color: '#8B8BA0' }}>Unlimited seats on your plan.</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: '#8B8BA0' }}>{sdrCount} of {maxSeats} seats used</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: seatsAtLimit ? '#EF4444' : '#22C55E' }}>
                {maxSeats - sdrCount} remaining
              </span>
            </div>
            <Bar value={sdrCount} max={maxSeats} color={seatsAtLimit ? '#EF4444' : '#6C63FF'} />
          </>
        )}

        {sdrs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Active SDRs</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sdrs.map(sdr => (
                <div key={sdr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: '#1C1C27', borderRadius: 7 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#F0F0F5' }}>{sdr.full_name}</span>
                    <span style={{ fontSize: 12, color: '#52526A', marginLeft: 8 }}>{sdr.email}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#52526A' }}>since {new Date(sdr.created_at).toLocaleDateString()}</span>
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
          <p style={{ fontSize: 13, color: '#8B8BA0' }}>Unlimited leads on your plan.</p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: '#8B8BA0' }}>{leadsCount.toLocaleString()} of {maxLeads.toLocaleString()} leads</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: leadsAtLimit ? '#EF4444' : '#22C55E' }}>
                {Math.max(0, maxLeads - leadsCount).toLocaleString()} remaining
              </span>
            </div>
            <Bar value={leadsCount} max={maxLeads} color={leadsAtLimit ? '#EF4444' : '#6C63FF'} />
          </>
        )}
        <p style={{ fontSize: 11, color: '#52526A', marginTop: 10 }}>
          Resets on {nextPeriod.toLocaleDateString()} · Leads are deleted after 3 months. Add Extended Data Retention to keep them.
        </p>
      </div>

      {/* Add-ons */}
      <div style={S.card}>
        <p style={{ ...S.sectionTitle, marginBottom: 16 }}>Active Add-ons</p>
        {addons.length === 0 ? (
          <p style={{ fontSize: 13, color: '#52526A' }}>No active add-ons.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {addons.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#1C1C27', borderRadius: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#F0F0F5' }}>{ADDON_LABELS[a.addon_type] ?? a.addon_type}</span>
                  <span style={{ display: 'inline-block', marginLeft: 10, fontSize: 10, backgroundColor: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E30', borderRadius: 3, padding: '1px 6px' }}>Active</span>
                </div>
                {a.price_monthly && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#8B8BA0' }}>${a.price_monthly}/mo</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buy Seats modal */}
      {showBuySeats && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 28, width: 380 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Buy More Seats</h3>
            <p style={{ fontSize: 13, color: '#8B8BA0', marginBottom: 20 }}>
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
// Main Settings page
// ────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'organization', label: 'Organization' },
  { key: 'pipeline',     label: 'Pipeline' },
  { key: 'support',      label: 'Support' },
  { key: 'plan',         label: 'Plan & Usage' },
]

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const locale = useLocale()
  const { user, orgPlan } = useUser()

  const tab = searchParams.get('tab') ?? 'organization'

  if (!user) {
    return <div style={{ padding: 40, color: '#52526A', textAlign: 'center' }}>Loading…</div>
  }

  if (user.role !== 'admin') {
    return (
      <div style={{ padding: 40, color: '#52526A', textAlign: 'center' }}>
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
      <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid #2A2A3A', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 18px',
              fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#F0F0F5' : '#52526A',
              borderBottom: tab === t.key ? '2px solid #6C63FF' : '2px solid transparent',
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
      {tab === 'support'      && <SupportTab orgPlan={orgPlan} />}
      {tab === 'plan'         && <PlanTab />}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: '#52526A', textAlign: 'center' }}>Loading…</div>}>
      <SettingsContent />
    </Suspense>
  )
}
