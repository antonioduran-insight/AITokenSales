'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { ICPScore } from '@/components/ui/ICPScore'
import { NotesLog } from './NotesLog'

import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { ExternalLink, Copy, Check, Star, ChevronDown, CheckCircle, X, Building2 } from 'lucide-react'
import { format } from 'date-fns'
import type { Prospect, OutreachStatus, LeadTemperature, User } from '@/lib/types'
import { OUTREACH_STATUSES, LEAD_TEMPERATURES } from '@/lib/types'

const CHANNEL_STATUS_COLORS: Record<string, string> = {
  pending: '#8B8BA0',
  active: '#3B82F6',
  in_conversation: '#F59E0B',
  pilot_agreed: '#A78BFA',
  live: '#22C55E',
  declined: '#EF4444',
}

interface ChannelContact {
  id: string
  name: string
  title: string | null
  outreach_status: string
}

interface Props {
  prospect: Prospect
  open: boolean
  onClose: () => void
  onUpdated: (p: Prospect) => void
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('prospect')
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 10px', borderRadius: 6, border: '1px solid var(--crm-border)',
        backgroundColor: copied ? '#1A3A2A' : 'var(--crm-surface-raised)',
        color: copied ? '#4ADE80' : 'var(--crm-text-secondary)',
        fontSize: 12, cursor: 'pointer',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? t('copied') : t('copyMessage')}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--crm-text-primary)' }}>{children}</div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '7px 28px 7px 10px',
  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
  borderRadius: 6, color: 'var(--crm-text-primary)', fontSize: 13,
  cursor: 'pointer', appearance: 'none' as const,
}

export function ProspectDrawer({ prospect: initial, open, onClose, onUpdated }: Props) {
  const t = useTranslations()
  const { isAdmin, user } = useUser()
  const { isImpersonating } = useOrgId()
  const [prospect, setProspect] = useState(initial)
  const [tab, setTab] = useState<'info' | 'messages' | 'notes' | 'channel'>('info')
  const [saving, setSaving] = useState(false)

  const [sdrsForArea, setSdrsForArea] = useState<User[]>([])
  const [reassigning, setReassigning] = useState(false)
  const [reassignToast, setReassignToast] = useState<string | null>(null)

  const isBdContact = prospect.lead_type === 'bd_channel_contact'
  const [channelNotes, setChannelNotes] = useState('')
  const [channelNotesSaving, setChannelNotesSaving] = useState(false)
  const [otherContacts, setOtherContacts] = useState<ChannelContact[]>([])

  if (initial.id !== prospect.id) setProspect(initial)

  useEffect(() => {
    setChannelNotes(prospect.bd_channel?.notes ?? '')
  }, [prospect.bd_channel?.notes])

  // Other contacts tracked under the same channel — fetched once per
  // channel, not gated behind the tab so the count is available even
  // before the reviewer opens the Channel tab
  useEffect(() => {
    if (!prospect.bd_channel_id) { setOtherContacts([]); return }
    createClient()
      .from('prospects')
      .select('id, name, title, outreach_status')
      .eq('bd_channel_id', prospect.bd_channel_id)
      .neq('id', prospect.id)
      .then(({ data }) => setOtherContacts((data ?? []) as ChannelContact[]))
  }, [prospect.bd_channel_id, prospect.id])

  useEffect(() => {
    if (!isAdmin || !prospect.area_id) return
    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('area_id', prospect.area_id)
      .order('full_name')
      .then(({ data }) => { if (data) setSdrsForArea(data as User[]) })
  }, [isAdmin, prospect.area_id])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function handleReassign(newSdrId: string) {
    if (!newSdrId || newSdrId === prospect.assigned_to) return
    setReassigning(true)
    const fromName = (prospect.assigned_user as User | undefined)?.full_name ?? 'Sin asignar'
    try {
      const res = await fetch('/api/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [prospect.id], assigned_to: newSdrId }),
      })
      const data = await res.json()
      if (!res.ok) { setReassigning(false); return }
      const newSdr = sdrsForArea.find(s => s.id === newSdrId)
      const updated = { ...prospect, assigned_to: newSdrId, assigned_user: newSdr }
      setProspect(updated as Prospect)
      onUpdated(updated as Prospect)
      await logAuditEvent({
        event_type: 'prospect_reassigned',
        prospect_id: prospect.id,
        prospect_name: prospect.name,
        metadata: { from_sdr: fromName, to_sdr: data.sdr_name },
      })
      setReassignToast(`Lead reasignado a ${data.sdr_name}`)
      setTimeout(() => setReassignToast(null), 3000)
    } finally { setReassigning(false) }
  }

  async function updateField(field: string, value: unknown) {
    if (isImpersonating) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('prospects').update({ [field]: value }).eq('id', prospect.id)
    if (!error) {
      const updated = { ...prospect, [field]: value }
      setProspect(updated)
      onUpdated(updated)
    }
    setSaving(false)
  }

  async function handleStatusChange(newStatus: OutreachStatus) {
    const prev = prospect.outreach_status
    await updateField('outreach_status', newStatus)
    await logAuditEvent({
      event_type: 'status_changed',
      prospect_id: prospect.id,
      prospect_name: prospect.name,
      metadata: { from_status: prev, to_status: newStatus },
    })
  }

  async function toggleFlag() { await updateField('flag_tomorrow', !prospect.flag_tomorrow) }

  async function saveChannelNotes() {
    if (isImpersonating || !prospect.bd_channel_id) return
    setChannelNotesSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('bd_channels')
      .update({ notes: channelNotes })
      .eq('id', prospect.bd_channel_id)
    if (!error && prospect.bd_channel) {
      const updated = { ...prospect, bd_channel: { ...prospect.bd_channel, notes: channelNotes } }
      setProspect(updated)
      onUpdated(updated)
    }
    setChannelNotesSaving(false)
  }

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 600 : 400,
    backgroundColor: active ? 'var(--crm-surface-raised)' : 'transparent',
    color: active ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)',
  })

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* Read-only banner */}
        {isImpersonating && (
          <div style={{ backgroundColor: '#1C1410', borderBottom: '1px solid #F59E0B', padding: '6px 20px', fontSize: 11, color: '#FCD34D', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            👁 Read-only view
          </div>
        )}

        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--crm-border)', flexShrink: 0, position: 'relative' }}>
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4, display: 'flex', alignItems: 'center', zIndex: 1 }}
          >
            <X size={18} />
          </button>
          <div style={{ marginBottom: 14, paddingRight: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button
                onClick={toggleFlag}
                disabled={isImpersonating}
                style={{ background: 'none', border: 'none', cursor: isImpersonating ? 'default' : 'pointer', padding: 0, opacity: isImpersonating ? 0.4 : 1, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                title={t('common.flagTomorrow')}
              >
                <Star size={15} fill={prospect.flag_tomorrow ? '#F59E0B' : 'none'} stroke={prospect.flag_tomorrow ? '#F59E0B' : 'var(--crm-text-muted)'} />
              </button>
              <h2 style={{ color: 'var(--crm-text-primary)', fontSize: 18, fontWeight: 700, margin: 0 }}>
                {prospect.name}
              </h2>
              {isBdContact && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  backgroundColor: '#6C63FF20', color: 'var(--crm-accent)',
                  borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                }}>
                  <Building2 size={10} /> BD
                </span>
              )}
              {prospect.area && <AreaBadge area={prospect.area} size="md" />}
            </div>
            {prospect.company && (
              <p style={{ color: 'var(--crm-text-secondary)', fontSize: 13, margin: 0 }}>
                {prospect.title && <span>{prospect.title} · </span>}
                {prospect.company}
              </p>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {(isBdContact ? (['info', 'channel', 'messages', 'notes'] as const) : (['info', 'messages', 'notes'] as const)).map(tab_ => (
              <button key={tab_} style={TAB_STYLE(tab === tab_)} onClick={() => setTab(tab_)}>
                {tab_ === 'info' ? t('prospect.info') : tab_ === 'channel' ? 'Channel' : tab_ === 'messages' ? t('prospect.messages') : t('prospect.notes')}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* INFO TAB */}
          {tab === 'info' && (
            <div>
              {/* Status + Temperature */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {t('prospect.outreachStatus')}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <select value={prospect.outreach_status} onChange={e => handleStatusChange(e.target.value as OutreachStatus)} style={selectStyle}>
                      {OUTREACH_STATUSES.map(s => <option key={s} value={s}>{t(`outreachStatus.${s}`)}</option>)}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {t('prospect.leadTemperature')}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <select value={prospect.lead_temperature ?? ''} onChange={e => updateField('lead_temperature', e.target.value || null)} style={selectStyle}>
                      <option value="">{t('common.none')}</option>
                      {LEAD_TEMPERATURES.map(temp => <option key={temp} value={temp}>{t(`temperature.${temp}`)}</option>)}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                  </div>
                </div>
              </div>

              {/* ICP Score */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  {t('prospect.icpScore')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="number" min={0} max={100}
                    value={prospect.icp_score ?? ''}
                    onChange={e => updateField('icp_score', e.target.value ? Number(e.target.value) : null)}
                    style={{ width: 80, padding: '6px 10px', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', fontSize: 13 }}
                  />
                  <ICPScore score={prospect.icp_score} size="md" />
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 16 }}>
                {prospect.linkedin_url && (
                  <Field label={t('prospect.linkedinUrl')}>
                    <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--crm-accent)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', fontSize: 13 }}>
                      {prospect.linkedin_url.replace('https://www.linkedin.com/', '')}
                      <ExternalLink size={11} />
                    </a>
                  </Field>
                )}
                {prospect.email && <Field label={t('prospect.email')}>{prospect.email}</Field>}
                {prospect.industry && <Field label={t('prospect.industry')}>{prospect.industry}</Field>}
                {prospect.company_size && <Field label={t('prospect.companySize')}>{prospect.company_size}</Field>}
                {prospect.market && <Field label={t('prospect.market')}>{prospect.market}</Field>}
                {prospect.search_combo && (
                  <Field label={t('prospect.searchCombo')}>
                    <span style={{ backgroundColor: 'var(--crm-surface-raised)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                      {t(`searchCombo.${prospect.search_combo}`)}
                    </span>
                  </Field>
                )}
                {prospect.scrape_date && (
                  <Field label={t('prospect.scrapeDate')}>
                    <span className="font-mono-data" style={{ fontSize: 12 }}>
                      {format(new Date(prospect.scrape_date), 'dd MMM yyyy')}
                    </span>
                  </Field>
                )}
                {isAdmin ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                      {t('prospect.assignedTo')}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={prospect.assigned_to ?? ''}
                        onChange={e => handleReassign(e.target.value)}
                        disabled={reassigning || sdrsForArea.length === 0}
                        style={{ ...selectStyle, opacity: reassigning ? 0.6 : 1 }}
                      >
                        <option value="">Sin asignar</option>
                        {sdrsForArea.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                    </div>
                    {sdrsForArea.length === 0 && (
                      <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 4 }}>No hay SDRs activos en esta área</p>
                    )}
                  </div>
                ) : prospect.assigned_user ? (
                  <Field label={t('prospect.assignedTo')}>
                    {(prospect.assigned_user as { full_name: string }).full_name}
                  </Field>
                ) : null}
                <Field label={t('prospect.createdAt')}>
                  <span className="font-mono-data" style={{ fontSize: 11, color: 'var(--crm-text-secondary)' }}>
                    {format(new Date(prospect.created_at), 'dd MMM yyyy, HH:mm')}
                  </span>
                </Field>
              </div>
            </div>
          )}

          {/* CHANNEL TAB (BD contacts only) */}
          {tab === 'channel' && (
            <div>
              {!prospect.bd_channel ? (
                <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>Channel details are not available.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Company
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Building2 size={16} color="var(--crm-accent)" />
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{prospect.bd_channel.company_name}</span>
                      <span style={{
                        marginLeft: 'auto', fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                        padding: '2px 8px', borderRadius: 4,
                        backgroundColor: (CHANNEL_STATUS_COLORS[prospect.bd_channel.status] ?? '#8B8BA0') + '20',
                        color: CHANNEL_STATUS_COLORS[prospect.bd_channel.status] ?? '#8B8BA0',
                      }}>
                        {prospect.bd_channel.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 16 }}>
                    {prospect.bd_channel.channel_family_type && (
                      <Field label="Channel Family">{prospect.bd_channel.channel_family_type.label}</Field>
                    )}
                    {prospect.bd_channel.partnership_model && (
                      <Field label="Partnership Model">{prospect.bd_channel.partnership_model}</Field>
                    )}
                    {prospect.bd_channel.market && (
                      <Field label={t('prospect.market')}>{prospect.bd_channel.market}</Field>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 16, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Channel Notes
                    </div>
                    <textarea
                      value={channelNotes}
                      onChange={e => setChannelNotes(e.target.value)}
                      onBlur={saveChannelNotes}
                      disabled={isImpersonating}
                      rows={3}
                      placeholder="Notes about this channel relationship…"
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
                        color: 'var(--crm-text-primary)', fontSize: 13, resize: 'vertical' as const,
                        opacity: isImpersonating ? 0.6 : 1,
                      }}
                    />
                    {channelNotesSaving && <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 4 }}>Saving…</p>}
                  </div>

                  <div style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 16, marginTop: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                      Other Contacts at This Company ({otherContacts.length})
                    </div>
                    {otherContacts.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>No other contacts tracked yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {otherContacts.map(c => (
                          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 10px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 6 }}>
                            <span style={{ color: 'var(--crm-text-primary)' }}>{c.name}{c.title ? ` · ${c.title}` : ''}</span>
                            <span style={{ color: 'var(--crm-text-muted)', fontSize: 11 }}>{c.outreach_status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* MESSAGES TAB */}
          {tab === 'messages' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {(['custom1', 'custom2', 'custom3'] as const).map(field => (
                <div key={field}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {t(`prospect.${field}`)}
                    </span>
                    {prospect[field] && <CopyButton text={prospect[field]!} />}
                  </div>
                  {prospect[field] ? (
                    <div style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--crm-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {prospect[field]}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{t('prospect.noMessage')}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* NOTES TAB */}
          {tab === 'notes' && (
            <NotesLog prospectId={prospect.id} prospectName={prospect.name} />
          )}

        </div>

        {/* Reassign toast */}
        {reassignToast && (
          <div style={{ position: 'absolute', bottom: 20, left: 20, right: 20, backgroundColor: '#1A3A2A', border: '1px solid #22C55E40', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#22C55E', zIndex: 10 }}>
            <CheckCircle size={14} />
            {reassignToast}
          </div>
        )}
      </div>
    </div>
  )
}
