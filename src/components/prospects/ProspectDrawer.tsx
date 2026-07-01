'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { ICPScore } from '@/components/ui/ICPScore'
import { NotesLog } from './NotesLog'
import { ConversationsLog } from '@/components/conversations/ConversationsLog'
import { useUser } from '@/contexts/UserContext'
import { ExternalLink, Copy, Check, Star, ChevronDown, CheckCircle } from 'lucide-react'
import { format } from 'date-fns'
import type { Prospect, OutreachStatus, LeadTemperature, User } from '@/lib/types'
import { OUTREACH_STATUSES, LEAD_TEMPERATURES } from '@/lib/types'

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
        padding: '5px 10px', borderRadius: 6, border: '1px solid #2A2A3A',
        backgroundColor: copied ? '#1A3A2A' : '#1C1C27',
        color: copied ? '#4ADE80' : '#8B8BA0',
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
      <div style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#F0F0F5' }}>{children}</div>
    </div>
  )
}

const TAB_STYLE = (active: boolean) => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  backgroundColor: active ? '#2A2A3A' : 'transparent',
  color: active ? '#F0F0F5' : '#8B8BA0',
})

export function ProspectDrawer({ prospect: initial, open, onClose, onUpdated }: Props) {
  const t = useTranslations()
  const { isAdmin, user } = useUser()
  const [prospect, setProspect] = useState(initial)
  const [tab, setTab] = useState<'info' | 'messages' | 'notes' | 'conversations'>('info')
  const [saving, setSaving] = useState(false)

  // Reassign (admin only)
  const [sdrsForArea, setSdrsForArea] = useState<User[]>([])
  const [reassigning, setReassigning] = useState(false)
  const [reassignToast, setReassignToast] = useState<string | null>(null)

  // Keep in sync when parent updates
  if (initial.id !== prospect.id) setProspect(initial)

  useEffect(() => {
    if (!isAdmin || !prospect.area_id) return
    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('area_id', prospect.area_id)
      .order('full_name')
      .then(({ data }) => {
        if (data) setSdrsForArea(data as User[])
      })
  }, [isAdmin, prospect.area_id])

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
    } finally {
      setReassigning(false)
    }
  }

  async function updateField(field: string, value: unknown) {
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

  async function toggleFlag() {
    await updateField('flag_tomorrow', !prospect.flag_tomorrow)
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="right"
        style={{
          width: 480,
          maxWidth: '95vw',
          backgroundColor: '#13131A',
          borderLeft: '1px solid #2A2A3A',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <SheetHeader style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A3A', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <SheetTitle style={{ color: '#F0F0F5', fontSize: 16, fontWeight: 700, margin: 0 }}>
                {prospect.name}
              </SheetTitle>
              {prospect.company && (
                <p style={{ color: '#8B8BA0', fontSize: 13, margin: '2px 0 0' }}>
                  {prospect.title && <span>{prospect.title} · </span>}
                  {prospect.company}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {prospect.area && <AreaBadge area={prospect.area} size="md" />}
              <button
                onClick={toggleFlag}
                title={t('common.flagTomorrow')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <Star
                  size={16}
                  fill={prospect.flag_tomorrow ? '#F59E0B' : 'none'}
                  stroke={prospect.flag_tomorrow ? '#F59E0B' : '#52526A'}
                />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {(['info', 'messages', 'notes', 'conversations'] as const).map(tab_ => (
              <button key={tab_} style={TAB_STYLE(tab === tab_)} onClick={() => setTab(tab_)}>
                {tab_ === 'info' ? t('prospect.info') : tab_ === 'messages' ? t('prospect.messages') : tab_ === 'notes' ? t('prospect.notes') : t('prospect.chats')}
              </button>
            ))}
          </div>
        </SheetHeader>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* INFO TAB */}
          {tab === 'info' && (
            <div>
              {/* Status + Temperature */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {t('prospect.outreachStatus')}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={prospect.outreach_status}
                      onChange={e => handleStatusChange(e.target.value as OutreachStatus)}
                      style={{
                        width: '100%', padding: '7px 28px 7px 10px',
                        backgroundColor: '#1C1C27', border: '1px solid #2A2A3A',
                        borderRadius: 6, color: '#F0F0F5', fontSize: 13,
                        cursor: 'pointer', appearance: 'none',
                      }}
                    >
                      {OUTREACH_STATUSES.map(s => (
                        <option key={s} value={s}>{t(`outreachStatus.${s}`)}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#52526A', pointerEvents: 'none' }} />
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {t('prospect.leadTemperature')}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={prospect.lead_temperature ?? ''}
                      onChange={e => updateField('lead_temperature', e.target.value || null)}
                      style={{
                        width: '100%', padding: '7px 28px 7px 10px',
                        backgroundColor: '#1C1C27', border: '1px solid #2A2A3A',
                        borderRadius: 6, color: '#F0F0F5', fontSize: 13,
                        cursor: 'pointer', appearance: 'none',
                      }}
                    >
                      <option value="">{t('common.none')}</option>
                      {LEAD_TEMPERATURES.map(temp => (
                        <option key={temp} value={temp}>{t(`temperature.${temp}`)}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#52526A', pointerEvents: 'none' }} />
                  </div>
                </div>
              </div>

              {/* ICP Score */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  {t('prospect.icpScore')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="number"
                    min={0} max={100}
                    value={prospect.icp_score ?? ''}
                    onChange={e => updateField('icp_score', e.target.value ? Number(e.target.value) : null)}
                    style={{
                      width: 80, padding: '6px 10px',
                      backgroundColor: '#1C1C27', border: '1px solid #2A2A3A',
                      borderRadius: 6, color: '#F0F0F5', fontSize: 13,
                    }}
                  />
                  <ICPScore score={prospect.icp_score} size="md" />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #2A2A3A', paddingTop: 16 }}>
                {prospect.linkedin_url && (
                  <Field label={t('prospect.linkedinUrl')}>
                    <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#6C63FF', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', fontSize: 13 }}>
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
                    <span style={{ backgroundColor: '#1C1C27', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
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
                    <div style={{ fontSize: 11, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                      {t('prospect.assignedTo')}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={prospect.assigned_to ?? ''}
                        onChange={e => handleReassign(e.target.value)}
                        disabled={reassigning || sdrsForArea.length === 0}
                        style={{
                          width: '100%', padding: '7px 28px 7px 10px',
                          backgroundColor: '#1C1C27', border: '1px solid #2A2A3A',
                          borderRadius: 6, color: '#F0F0F5', fontSize: 13,
                          cursor: 'pointer', appearance: 'none',
                          opacity: reassigning ? 0.6 : 1,
                        }}
                      >
                        <option value="">Sin asignar</option>
                        {sdrsForArea.map(s => (
                          <option key={s.id} value={s.id}>{s.full_name}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#52526A', pointerEvents: 'none' }} />
                    </div>
                    {sdrsForArea.length === 0 && (
                      <p style={{ fontSize: 11, color: '#52526A', marginTop: 4 }}>No hay SDRs activos en esta área</p>
                    )}
                  </div>
                ) : prospect.assigned_user ? (
                  <Field label={t('prospect.assignedTo')}>
                    {(prospect.assigned_user as { full_name: string }).full_name}
                  </Field>
                ) : null}
                <Field label={t('prospect.createdAt')}>
                  <span className="font-mono-data" style={{ fontSize: 11, color: '#8B8BA0' }}>
                    {format(new Date(prospect.created_at), 'dd MMM yyyy, HH:mm')}
                  </span>
                </Field>
              </div>
            </div>
          )}

          {/* MESSAGES TAB */}
          {tab === 'messages' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {(['custom1', 'custom2', 'custom3'] as const).map(field => (
                <div key={field}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#8B8BA0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {t(`prospect.${field}`)}
                    </span>
                    {prospect[field] && <CopyButton text={prospect[field]!} />}
                  </div>
                  {prospect[field] ? (
                    <div style={{
                      backgroundColor: '#1C1C27', border: '1px solid #2A2A3A',
                      borderRadius: 8, padding: '12px 14px',
                      fontSize: 13, color: '#F0F0F5', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    }}>
                      {prospect[field]}
                    </div>
                  ) : (
                    <p style={{ color: '#52526A', fontSize: 13 }}>{t('prospect.noMessage')}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* NOTES TAB */}
          {tab === 'notes' && (
            <NotesLog prospectId={prospect.id} prospectName={prospect.name} />
          )}

          {/* CONVERSATIONS TAB */}
          {tab === 'conversations' && (
            <ConversationsLog
              prospectId={prospect.id}
              prospectName={prospect.name}
              isClosed={prospect.outreach_status === 'closed'}
            />
          )}
        </div>

        {/* Reassign toast */}
        {reassignToast && (
          <div style={{
            position: 'absolute', bottom: 20, left: 20, right: 20,
            backgroundColor: '#1A3A2A', border: '1px solid #22C55E40',
            borderRadius: 8, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: '#22C55E', zIndex: 10,
          }}>
            <CheckCircle size={14} />
            {reassignToast}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
