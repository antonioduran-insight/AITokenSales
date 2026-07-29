'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { AreaBadge } from '@/components/ui/AreaBadge'
import { TemperatureBadge } from '@/components/ui/TemperatureBadge'
import { ICPScore } from '@/components/ui/ICPScore'
import { NotesLog } from './NotesLog'
import { CloseDealModal } from '@/components/conversations/CloseDealModal'

import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { useComboLabels } from '@/lib/hooks/useComboLabels'
import { useOrgMarkets } from '@/lib/hooks/useOrgMarkets'
import { useMarketAreaMap } from '@/lib/hooks/useMarketAreaMap'
import { inferAreaFromCountry } from '@/lib/utils/area-inference'
import { ExternalLink, Copy, Check, Star, ChevronDown, CheckCircle, AlertTriangle, X, Pencil } from 'lucide-react'
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

const textInputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', boxSizing: 'border-box' as const,
  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
  borderRadius: 6, color: 'var(--crm-text-primary)', fontSize: 13, outline: 'none',
}

type ToastVariant = 'success' | 'warning' | 'error'

const TOAST_STYLE: Record<ToastVariant, React.CSSProperties> = {
  success: { backgroundColor: '#1A3A2A', border: '1px solid #22C55E40', color: '#22C55E' },
  warning: { backgroundColor: '#3A2E12', border: '1px solid #F59E0B40', color: '#FCD34D' },
  error:   { backgroundColor: '#3A1A1E', border: '1px solid #EF444440', color: '#F87171' },
}

export function ProspectDrawer({ prospect: initial, open, onClose, onUpdated }: Props) {
  const t = useTranslations()
  const comboLabels = useComboLabels()
  const { markets: orgMarkets } = useOrgMarkets()
  const marketAreaMap = useMarketAreaMap()
  const { isAdmin, user } = useUser()
  // `isReadOnly`, not `isImpersonating`: a Global Admin on a bare CRM URL (no
  // `?impersonate_org_id=`) is read-only too, and gating on `isImpersonating`
  // left every write in this drawer wide open for that role. Nothing here routes
  // reads through `/api/crm/[table]`, which is the only thing `isImpersonating`
  // is still the right flag for — so this component needs the read-only flag only.
  const { isReadOnly } = useOrgId()
  const [prospect, setProspect] = useState(initial)
  const [tab, setTab] = useState<'info' | 'messages' | 'notes'>('info')
  const [saving, setSaving] = useState(false)

  const [sdrsForArea, setSdrsForArea] = useState<User[]>([])
  // Distinguishes "no SDRs in this area" from "the SDR list hasn't arrived yet" —
  // without it the empty initial array reads as "the owner isn't in this area"
  // and flashes the inconsistency warning on every open.
  const [sdrsLoaded, setSdrsLoaded] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingClose, setPendingClose] = useState(false)
  const [closingSaving, setClosingSaving] = useState(false)
  const [editingField, setEditingField] = useState<'custom1' | 'custom2' | null>(null)
  const [editValue, setEditValue] = useState('')
  // Local drafts for the plain-text editable fields (company/title) so the
  // input stays responsive while typing — committed to the DB on blur,
  // rather than on every keystroke like the select-based fields below.
  const [companyDraft, setCompanyDraft] = useState(initial.company ?? '')
  const [titleDraft, setTitleDraft] = useState(initial.title ?? '')

  if (initial.id !== prospect.id) {
    setProspect(initial)
    setCompanyDraft(initial.company ?? '')
    setTitleDraft(initial.title ?? '')
  }

  // A failure message has to stay up long enough to be read — a 3s green flash
  // was fine for "Saved", it is not fine for "nothing was saved".
  function showToast(message: string, variant: ToastVariant = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, variant })
    toastTimer.current = setTimeout(() => setToast(null), variant === 'success' ? 3000 : 8000)
  }

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    if (!isAdmin) return
    setSdrsLoaded(false)
    if (!prospect.area_id) { setSdrsForArea([]); setSdrsLoaded(true); return }
    createClient()
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('area_id', prospect.area_id)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) {
          // Left as "not loaded": an empty list from a failed query must not be
          // presented as a factual "this area has no SDRs".
          console.error(`[prospect-drawer] could not load SDRs for area (${error.code}): ${error.message}`)
          return
        }
        setSdrsForArea((data ?? []) as User[])
        setSdrsLoaded(true)
      })
  }, [isAdmin, prospect.area_id])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function handleReassign(newSdrId: string) {
    // Read-only mode is enforced everywhere else in the drawer; this write was
    // the one that still went through to /api/prospects.
    if (isReadOnly) return
    if (!newSdrId || newSdrId === prospect.assigned_to) return
    setReassigning(true)
    const fromName = (prospect.assigned_user as User | undefined)?.full_name ?? t('common.unassigned')
    try {
      const res = await fetch('/api/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [prospect.id], assigned_to: newSdrId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Used to bail out with zero feedback — the dropdown snapped back to the
        // old owner and the user had no way to tell whether it had worked.
        console.error(`[prospect-drawer] reassign failed (${res.status}): ${data?.error ?? 'unknown error'}`)
        showToast(t('prospect.saveFailed'), 'error')
        return
      }
      const newSdr = sdrsForArea.find(s => s.id === newSdrId)
      const updated = { ...prospect, assigned_to: newSdrId, assigned_user: newSdr }
      setProspect(updated as Prospect)
      onUpdated(updated as Prospect)
      const logged = await logAuditEvent({
        event_type: 'prospect_reassigned',
        prospect_id: prospect.id,
        prospect_name: prospect.name,
        metadata: { from_sdr: fromName, to_sdr: data.sdr_name },
      })
      if (logged) showToast(t('common.reassignedTo', { name: data.sdr_name }))
      else showToast(t('prospect.savedNoAudit'), 'warning')
    } finally { setReassigning(false) }
  }

  // QA-F11: every field save now surfaces the same generic confirmation —
  // previously nothing in the drawer gave any visual feedback on save.
  // `extraDb` merges more real columns into the same UPDATE (used by the
  // Market edit below to also persist area_id); `extraLocal` merges
  // additional fields into local state only, for values (like the joined
  // `area` object) that aren't real prospects columns.
  //
  // Returns true only when the row was actually written. This used to be
  // `if (!error) { ... }` with no `else` and no return value, so a rejected
  // UPDATE (RLS, constraint, network) was indistinguishable from a successful
  // one: the caller still showed a green "Saved" and still wrote an audit row
  // for a change that never happened. Every caller must now branch on the
  // result — never assume the write landed.
  async function updateField(
    field: string,
    value: unknown,
    opts?: { silent?: boolean; extraDb?: Record<string, unknown>; extraLocal?: Record<string, unknown> }
  ): Promise<boolean> {
    if (isReadOnly) return false
    setSaving(true)
    const supabase = createClient()
    const dbPatch = { [field]: value, ...(opts?.extraDb ?? {}) }
    const { error } = await supabase.from('prospects').update(dbPatch).eq('id', prospect.id)
    setSaving(false)

    if (error) {
      console.error(
        `[prospect-drawer] update of "${field}" on prospect ${prospect.id} failed (${error.code}): ${error.message}`
      )
      showToast(t('prospect.saveFailed'), 'error')
      return false
    }

    const updated = { ...prospect, ...dbPatch, ...(opts?.extraLocal ?? {}) }
    setProspect(updated)
    onUpdated(updated)
    if (!opts?.silent) showToast(t('common.saved'))
    return true
  }

  // Company/Job Title/Market/Search Combo are now editable, matching the
  // rest of the drawer's fields, and log to the Audit Log the same way
  // status changes already do.
  async function saveEditableField(field: 'company' | 'title' | 'market' | 'search_combo', value: string | null, label: string) {
    if (isReadOnly) return
    const prev = prospect[field] ?? null
    if (value === prev) return

    // QA-F31: editing Market must keep area_id (and the board it lands on)
    // in sync — otherwise the lead is stuck on whatever area it started
    // with regardless of its real market, the same class of bug QA-F25
    // fixed for run-assignment. Same market→area lookup either way.
    //
    // Every branch where the area CANNOT be resolved now aborts instead of
    // saving the market anyway: writing `market` while leaving the old
    // `area_id` in place is precisely the inconsistent state QA-F31 exists to
    // prevent, and it was previously done silently, with a green toast.
    let extraDb: Record<string, unknown> | undefined
    let extraLocal: Record<string, unknown> | undefined
    // Non-success note shown *instead of* "Saved" when the write went through
    // but left something the user needs to know about.
    let caveat: string | null = null

    if (field === 'market') {
      // `useMarketAreaMap()` is async and starts out `{}`; an empty map is
      // indistinguishable from "every market is unknown", so saving during that
      // window would silently skip the area recalculation for a market that
      // resolves perfectly well a second later. Refuse rather than guess.
      if (Object.keys(marketAreaMap).length === 0) {
        showToast(t('prospect.marketMapLoading'), 'warning')
        return
      }

      if (value === null) {
        // No market ⇒ nothing to derive an area from. Keeping the current
        // area_id is the only honest option (area_id is NOT NULL anyway), but
        // the user is told rather than left to assume the board moved.
        caveat = t('prospect.marketClearedAreaKept')
      } else {
        const areaName = inferAreaFromCountry(value, marketAreaMap)
        if (!areaName) {
          // Real case: multi-country runs store the *region* name ("Asia",
          // "USA") in prospects.market, and those are not rows in `markets`.
          showToast(t('prospect.marketNoArea', { market: value }), 'error')
          return
        }
        const supabase = createClient()
        const { data: areaRow, error: areaError } = await supabase
          .from('areas').select('*').eq('name', areaName).maybeSingle()
        if (areaError || !areaRow) {
          if (areaError) {
            console.error(`[prospect-drawer] area lookup for "${areaName}" failed (${areaError.code}): ${areaError.message}`)
          }
          showToast(t('prospect.areaRowMissing', { area: areaName }), 'error')
          return
        }
        extraDb = { area_id: areaRow.id }
        extraLocal = { area: areaRow }
        // The lead is about to change area while keeping its owner. The owner
        // stays visible/selected in the dropdown (see the fallback <option>
        // below) — say so out loud instead of letting it look unassigned.
        if (areaRow.id !== prospect.area_id && prospect.assigned_to) {
          caveat = t('prospect.savedOwnerOtherArea')
        }
      }
    }

    const ok = await updateField(field, value, { silent: true, extraDb, extraLocal })
    if (!ok) {
      // updateField already showed the error toast. Re-sync the local drafts so
      // the inputs stop displaying a value that is not in the database.
      if (field === 'company') setCompanyDraft(prospect.company ?? '')
      if (field === 'title') setTitleDraft(prospect.title ?? '')
      return
    }

    const logged = await logAuditEvent({
      event_type: 'prospect_updated',
      prospect_id: prospect.id,
      prospect_name: prospect.name,
      metadata: { field: label, from: prev ?? '—', to: value ?? '—' },
    })

    // The change DID happen, so this is never an error — but it is not a plain
    // "Saved" either: an edit with no audit row is exactly what nobody can
    // reconstruct later, so it gets its own amber message.
    if (!logged) showToast(t('prospect.savedNoAudit'), 'warning')
    else if (caveat) showToast(caveat, 'warning')
    else showToast(t('common.saved'))
  }

  function startEditMessage(field: 'custom1' | 'custom2') {
    setEditingField(field)
    setEditValue(prospect[field] ?? '')
  }

  function cancelEditMessage() {
    setEditingField(null)
    setEditValue('')
  }

  async function saveEditMessage() {
    if (!editingField) return
    const ok = await updateField(editingField, editValue.trim() || null)
    // Stay in edit mode on failure — closing the editor would throw away text
    // the user typed for a save that never landed.
    if (!ok) return
    setEditingField(null)
    setEditValue('')
  }

  async function commitStatusChange(newStatus: OutreachStatus): Promise<boolean> {
    const prev = prospect.outreach_status
    const ok = await updateField('outreach_status', newStatus, { silent: true })
    if (!ok) return false
    const logged = await logAuditEvent({
      event_type: 'status_changed',
      prospect_id: prospect.id,
      prospect_name: prospect.name,
      metadata: { from_status: prev, to_status: newStatus },
    })
    showToast(logged ? t('common.saved') : t('prospect.savedNoAudit'), logged ? 'success' : 'warning')
    return true
  }

  async function handleStatusChange(newStatus: OutreachStatus) {
    // Moving to Closed is gated behind the mandatory chat-upload modal — the
    // status isn't committed until the modal resolves (Save or Skip).
    if (newStatus === 'closed' && prospect.outreach_status !== 'closed') {
      setPendingClose(true)
      return
    }
    await commitStatusChange(newStatus)
  }

  async function handleCloseSave(chatContent: string) {
    setClosingSaving(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospect.id, chat_content: chatContent, reason: 'Uploaded at close' }),
      })
      if (!res.ok) {
        console.error(`[prospect-drawer] conversation upload failed (${res.status})`)
        showToast(t('prospect.saveFailed'), 'error')
        return
      }
      await logAuditEvent({
        event_type: 'conversation_added',
        prospect_id: prospect.id,
        prospect_name: prospect.name,
        metadata: { source: 'drawer_close' },
      })
      // Keep the modal open if the status write itself failed — dismissing it
      // would look like the deal closed when it did not.
      if (await commitStatusChange('closed')) setPendingClose(false)
    } finally {
      setClosingSaving(false)
    }
  }

  async function handleCloseSkip() {
    setClosingSaving(true)
    try {
      if (await commitStatusChange('closed')) setPendingClose(false)
    } finally {
      setClosingSaving(false)
    }
  }

  async function toggleFlag() { await updateField('flag_tomorrow', !prospect.flag_tomorrow) }

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 600 : 400,
    backgroundColor: active ? 'var(--crm-surface-raised)' : 'transparent',
    color: active ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)',
  })

  // The lead's real owner is not among the SDRs of the lead's *current* area.
  // Happens the moment the Market (and therefore area_id) changes: the effect
  // above reloads `sdrsForArea` for the new area, the owner is no longer one of
  // the <option>s, and the browser silently falls back to the first one — the
  // select showed "Unassigned" while the DB still had the lead assigned, one
  // stray click away from reassigning a lead that already had an owner.
  //
  // Fallback pattern is the same one Market and Search Combo already use for a
  // value that is not in the current catalogue: give the current value its own
  // <option> so it stays rendered and stays selected.
  const ownerOutsideArea =
    sdrsLoaded && Boolean(prospect.assigned_to) && !sdrsForArea.some(s => s.id === prospect.assigned_to)
  const ownerName = (prospect.assigned_user as User | undefined)?.full_name ?? t('prospect.ownerUnknown')

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* Read-only banner — on `isReadOnly`, so a Global Admin who is not
            impersonating also sees why every control is disabled */}
        {isReadOnly && (
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
                disabled={isReadOnly}
                style={{ background: 'none', border: 'none', cursor: isReadOnly ? 'default' : 'pointer', padding: 0, opacity: isReadOnly ? 0.4 : 1, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                title={t('common.flagTomorrow')}
              >
                <Star size={15} fill={prospect.flag_tomorrow ? '#F59E0B' : 'none'} stroke={prospect.flag_tomorrow ? '#F59E0B' : 'var(--crm-text-muted)'} />
              </button>
              <h2 style={{ color: 'var(--crm-text-primary)', fontSize: 18, fontWeight: 700, margin: 0 }}>
                {prospect.name}
              </h2>
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
            {(['info', 'messages', 'notes'] as const).map(tab_ => (
              <button key={tab_} style={TAB_STYLE(tab === tab_)} onClick={() => setTab(tab_)}>
                {tab_ === 'info' ? t('prospect.info') : tab_ === 'messages' ? t('prospect.messages') : t('prospect.notes')}
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
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    {t('prospect.outreachStatus')}
                  </div>
                  <div style={{ position: 'relative' }}>
                    {/* Disabled in read-only mode: updateField() no-ops there, so an
                        enabled control just silently swallowed the change */}
                    <select value={prospect.outreach_status} disabled={isReadOnly} onChange={e => handleStatusChange(e.target.value as OutreachStatus)} style={selectStyle}>
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
                    <select value={prospect.lead_temperature ?? ''} disabled={isReadOnly} onChange={e => updateField('lead_temperature', e.target.value || null)} style={selectStyle}>
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
                    disabled={isReadOnly}
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

                <Field label={t('prospect.company')}>
                  <input
                    type="text"
                    value={companyDraft}
                    disabled={isReadOnly}
                    onChange={e => setCompanyDraft(e.target.value)}
                    onBlur={() => saveEditableField('company', companyDraft.trim() || null, t('prospect.company'))}
                    style={textInputStyle}
                  />
                </Field>

                <Field label={t('prospect.title')}>
                  <input
                    type="text"
                    value={titleDraft}
                    disabled={isReadOnly}
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={() => saveEditableField('title', titleDraft.trim() || null, t('prospect.title'))}
                    style={textInputStyle}
                  />
                </Field>

                {prospect.industry && <Field label={t('prospect.industry')}>{prospect.industry}</Field>}
                {prospect.company_size && <Field label={t('prospect.companySize')}>{prospect.company_size}</Field>}

                <Field label={t('prospect.market')}>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={prospect.market ?? ''}
                      disabled={isReadOnly}
                      onChange={e => saveEditableField('market', e.target.value || null, t('prospect.market'))}
                      style={selectStyle}
                    >
                      <option value="">{t('common.none')}</option>
                      {orgMarkets.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      {/* A market the org no longer has activated still shows, so the field doesn't silently blank out an existing value */}
                      {prospect.market && !orgMarkets.some(m => m.name === prospect.market) && (
                        <option value={prospect.market}>{prospect.market}</option>
                      )}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                  </div>
                </Field>

                <Field label={t('prospect.searchCombo')}>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={prospect.search_combo ?? ''}
                      disabled={isReadOnly}
                      onChange={e => saveEditableField('search_combo', e.target.value || null, t('prospect.searchCombo'))}
                      style={selectStyle}
                    >
                      <option value="">{t('common.none')}</option>
                      {Object.entries(comboLabels).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                      {/* A combo that's since been deactivated org-wide still shows, same fallback as elsewhere */}
                      {prospect.search_combo && !(prospect.search_combo in comboLabels) && (
                        <option value={prospect.search_combo}>{prospect.search_combo}</option>
                      )}
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                  </div>
                </Field>
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
                        disabled={isReadOnly || reassigning || !sdrsLoaded || (sdrsForArea.length === 0 && !ownerOutsideArea)}
                        style={{ ...selectStyle, opacity: reassigning ? 0.6 : 1 }}
                      >
                        <option value="">{t('common.unassigned')}</option>
                        {/* The current owner stays listed even when they are not an SDR of
                            this lead's area, so the select can never misreport an assigned
                            lead as unassigned */}
                        {ownerOutsideArea && <option value={prospect.assigned_to!}>{ownerName}</option>}
                        {sdrsForArea.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--crm-text-muted)', pointerEvents: 'none' }} />
                    </div>
                    {ownerOutsideArea && (
                      <p style={{ fontSize: 11, color: '#FCD34D', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 5, lineHeight: 1.4 }}>
                        <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{t('prospect.ownerOutsideArea')}</span>
                      </p>
                    )}
                    {sdrsLoaded && sdrsForArea.length === 0 && (
                      <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 4 }}>{t('common.noActiveSdrsInArea')}</p>
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

          {/* MESSAGES TAB */}
          {tab === 'messages' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {(['custom1', 'custom2'] as const).map(field => {
                const isEditing = editingField === field
                return (
                  <div key={field}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {t(`prospect.${field}`)}
                      </span>
                      {!isEditing && !isReadOnly && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {prospect[field] && <CopyButton text={prospect[field]!} />}
                          <button
                            onClick={() => startEditMessage(field)}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'var(--crm-surface-raised)', color: 'var(--crm-text-secondary)', fontSize: 12, cursor: 'pointer' }}
                          >
                            <Pencil size={12} /> {t('common.edit')}
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <div>
                        <textarea
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          rows={6}
                          autoFocus
                          style={{ width: '100%', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-accent)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--crm-text-primary)', lineHeight: 1.6, outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            onClick={saveEditMessage}
                            disabled={saving}
                            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', backgroundColor: 'var(--crm-accent)', color: '#FFF', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
                          >
                            {saving ? t('common.loading') : t('common.save')}
                          </button>
                          <button
                            onClick={cancelEditMessage}
                            disabled={saving}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', fontSize: 12, cursor: 'pointer' }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : prospect[field] ? (
                      <div style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--crm-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {prospect[field]}
                      </div>
                    ) : (
                      <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{t('prospect.noMessage')}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* NOTES TAB */}
          {tab === 'notes' && (
            <NotesLog prospectId={prospect.id} prospectName={prospect.name} />
          )}

        </div>

        {/* Save/reassign feedback toast (QA-F11). Three variants now — a green
            "Saved" for a write that actually landed, amber for "it landed but
            with a caveat", red for "nothing was written". It was green-only,
            which is how a failed UPDATE could report success. */}
        {toast && (
          <div style={{
            position: 'absolute', bottom: 20, left: 20, right: 20,
            borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start',
            gap: 8, fontSize: 13, lineHeight: 1.45, zIndex: 10,
            ...TOAST_STYLE[toast.variant],
          }}>
            {toast.variant === 'success'
              ? <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              : <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      <CloseDealModal
        open={pendingClose}
        prospectName={prospect.name}
        saving={closingSaving}
        onSave={handleCloseSave}
        onSkip={handleCloseSkip}
        onCancel={() => setPendingClose(false)}
      />
    </div>
  )
}
