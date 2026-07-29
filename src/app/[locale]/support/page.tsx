'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { Plus, X, ChevronDown, ChevronUp, Send, RefreshCw } from 'lucide-react'

interface TicketMessage {
  id: string
  ticket_id: string
  created_by: string
  content: string
  created_at: string
  author_name?: string
}

interface SupportTicket {
  id: string
  subject: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string
  created_by: string
  messages: TicketMessage[]
  created_by_user?: { id: string; full_name: string }
  organization?: { id: string; name: string } | null
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}
const STATUS_COLORS: Record<string, string> = {
  open: '#6C63FF', in_progress: '#F59E0B', closed: '#52526A', resolved: '#52526A',
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 900 },
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: 20, marginBottom: 12 },
  input: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 7, color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const },
  label: { fontSize: 12, color: 'var(--crm-text-secondary)', fontWeight: 600, display: 'block', marginBottom: 6 },
  btn: { backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
  th: { fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  sectionHeading: { fontSize: 12, fontWeight: 700, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' },
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      backgroundColor: color + '22', color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    }}>
      {label}
    </span>
  )
}

export default function SupportPage() {
  const t = useTranslations('support')
  const tc = useTranslations('common')
  const { user, isAdmin } = useUser()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterPriority, setFilterPriority] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [sending, setSending] = useState(false)
  const [orgUsers, setOrgUsers] = useState<{ id: string; full_name: string }[]>([])

  // New ticket modal
  const [showNew, setShowNew] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // support/admin_global are org-independent — they see every org's
  // tickets, not just their own (org admins/SDRs never hit this branch,
  // since they always have a real organization_id). Computed up top since
  // the realtime subscriptions below need it.
  const isCrossOrgViewer = user?.role === 'support' || user?.role === 'admin_global'
  const canManage = isAdmin || isCrossOrgViewer

  const getUserName = (userId: string) => {
    const found = orgUsers.find(u => u.id === userId)
    return found?.full_name ?? t('unknownUser')
  }

  // Always-fresh mirror of `tickets` for closures that shouldn't re-subscribe
  // every time the list changes (the realtime effects below only depend on
  // stable identifiers, not on `tickets` itself).
  const ticketsRef = useRef<SupportTicket[]>(tickets)
  useEffect(() => { ticketsRef.current = tickets }, [tickets])

  // A message's author_name only comes from the enriched GET response — a
  // raw realtime INSERT payload doesn't have it. Look it up from whatever
  // we already know about that user from other tickets/messages in memory
  // before falling back to the generic label.
  const resolveAuthorName = useCallback((userId: string): string => {
    for (const ticket of ticketsRef.current) {
      if (ticket.created_by === userId && ticket.created_by_user?.full_name) return ticket.created_by_user.full_name
      const found = ticket.messages.find(m => m.created_by === userId && m.author_name)
      if (found?.author_name) return found.author_name
    }
    return canManage ? getUserName(userId) : t('supportTeam')
  // `t` is deliberately not a dependency: this callback is itself a dependency
  // of the realtime effect below, and a new identity on every render would tear
  // the channel down and re-subscribe it on each render (see the comment there).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  // Status of the currently expanded ticket, read during render so the effect
  // below can depend on a primitive that only changes when the status actually
  // changes — never on every incoming message.
  const expandedStatus = expandedId ? tickets.find(x => x.id === expandedId)?.status : undefined

  // Realtime subscription for expanded ticket messages (only when not closed).
  //
  // This effect must NOT depend on `tickets`: its own handler calls
  // setTickets, so listing `tickets` as a dependency made every arriving
  // message tear the channel down and re-subscribe it — a window where events
  // are dropped, plus constant websocket churn (the observed symptom was
  // in-thread messages showing up late while new tickets appeared instantly).
  // The ticket list is read through `ticketsRef` (kept fresh above) instead.
  useEffect(() => {
    if (!expandedId || expandedStatus === 'closed') return
    const supabase = createClient()
    const channel = supabase
      .channel(`ticket-messages-${expandedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_ticket_messages', filter: `ticket_id=eq.${expandedId}` },
        (payload) => {
          const newMsg = payload.new as TicketMessage
          setTickets(prev => prev.map(x => {
            if (x.id !== expandedId) return x
            if (x.messages.some(m => m.id === newMsg.id)) return x
            const enriched = newMsg.created_by === user?.id ? newMsg : { ...newMsg, author_name: resolveAuthorName(newMsg.created_by) }
            return { ...x, messages: [...x.messages, enriched] }
          }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [expandedId, expandedStatus, user?.id, resolveAuthorName])

  // Silent variant used by the background realtime sync below — doesn't
  // toggle `loading`, which would otherwise hide the whole list (including
  // whatever thread the user has open) every time any ticket changes.
  const fetchTicketsSilent = useCallback(async () => {
    try {
      const res = await fetch('/api/support/tickets')
      const data = await res.json()
      if (Array.isArray(data)) setTickets(data)
    } catch { /* next event or manual refresh will retry */ }
  }, [])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    await fetchTicketsSilent()
    setLoading(false)
  }, [fetchTicketsSilent])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // ── Ticket arrival alert ────────────────────────────────────────────────
  // Browsers block audio until the page has seen a real user gesture. The
  // previous version registered its unlock listener with `{ once: true }`,
  // which broke the exact scenario this alert exists for:
  //   (a) an agent who opens the tab and never clicks inside it left
  //       `audioCtxRef` null forever, so every alert was silently dropped;
  //   (b) the "resume a suspended context" branch lived inside that same
  //       one-shot listener, so it was unreachable after the first gesture —
  //       and Chrome suspends the AudioContext whenever the tab goes to the
  //       background, which is precisely where a waiting agent's tab sits.
  // Now: the gesture listeners stay registered (every gesture is another
  // chance to unlock), the context is resumed on `visibilitychange` and again
  // at alert time, and if the browser still refuses to make noise the alert
  // degrades to something visible (tab-title counter + in-page banner)
  // instead of vanishing.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [mutedAlerts, setMutedAlerts] = useState(0)

  const ensureAudioCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new Ctor() } catch { return null }
    }
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  }, [])

  useEffect(() => {
    const onGesture = () => { ensureAudioCtx() }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      // Coming back to the tab both revives the context Chrome suspended and
      // clears the visual fallback — the agent is looking at the list now.
      ensureAudioCtx()
      setMutedAlerts(0)
    }
    // Not `{ once: true }` — a later gesture must still be able to unlock or
    // resume the context.
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    document.addEventListener('visibilitychange', onVisibility)
    // Try straight away too: in a tab the user has already interacted with,
    // this succeeds with no further gesture needed.
    ensureAudioCtx()
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ensureAudioCtx])

  // Visible fallback: prefix the tab title so a backgrounded tab still shows
  // that something arrived even with audio blocked.
  const baseTitleRef = useRef<string>('')
  useEffect(() => {
    if (!baseTitleRef.current) baseTitleRef.current = document.title
    document.title = mutedAlerts > 0 ? `(${mutedAlerts}) ${baseTitleRef.current}` : baseTitleRef.current
  }, [mutedAlerts])

  const playNotificationSound = useCallback(() => {
    const ctx = ensureAudioCtx()

    // Only a context that is actually `running` makes a sound — scheduling on
    // a suspended one succeeds silently, which is how the old version managed
    // to "work" while being inaudible.
    const beep = (): boolean => {
      if (!ctx || ctx.state !== 'running') return false
      try {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.type = 'sine'
        oscillator.frequency.value = 880
        gain.gain.setValueAtTime(0.18, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
        oscillator.start()
        oscillator.stop(ctx.currentTime + 0.4)
        return true
      } catch { return false }
    }

    if (beep()) return
    if (!ctx) { setMutedAlerts(n => n + 1); return }

    // Suspended. `ensureAudioCtx` already asked for a resume, but Chrome
    // leaves that promise unsettled until the page receives a gesture, so
    // don't await it — retry after a short grace period and degrade to the
    // visible alert if it's still muted.
    ctx.resume().catch(() => {})
    window.setTimeout(() => { if (!beep()) setMutedAlerts(n => n + 1) }, 250)
  }, [ensureAudioCtx])

  // New/updated tickets show up live for everyone — RLS on support_tickets
  // already scopes what each role receives (own org for admin/SDR, every
  // org for support/admin_global), so one subscription works for all of
  // them without extra client-side filtering.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('support-tickets-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_tickets' }, () => {
        fetchTicketsSilent()
        if (isCrossOrgViewer) playNotificationSound()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_tickets' }, () => {
        fetchTicketsSilent()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTicketsSilent, isCrossOrgViewer, playNotificationSound])

  useEffect(() => {
    if (isAdmin && user?.organization_id) {
      createClient()
        .from('users')
        .select('id, full_name')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('full_name')
        .then(({ data }) => { if (data) setOrgUsers(data as { id: string; full_name: string }[]) })
    }
  }, [isAdmin, user?.organization_id])

  async function createTicket() {
    if (!subject.trim() || !description.trim()) { setError(t('errRequiredFields')); return }
    setCreating(true); setError(null)
    const res = await fetch('/api/support/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, description, priority }),
    })
    const data = await res.json()
    // `data.error` is whatever the API sent (not a translation key) — fall back
    // to the generic localised message when the response carries none.
    if (!res.ok) { setError(data.error || tc('error')); setCreating(false); return }
    setTickets(prev => [data, ...prev])
    setSubject(''); setDescription(''); setPriority('medium')
    setShowNew(false); setCreating(false)
  }

  async function sendReply(ticketId: string) {
    if (!replyContent.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyContent }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('sendReply error:', data)
        return
      }
      setTickets(prev => prev.map(x => x.id === ticketId
        ? { ...x, messages: [...x.messages.filter(m => m.id !== data.id), data] }
        : x
      ))
      setReplyContent('')
    } catch (e) {
      console.error('sendReply exception:', e)
    } finally {
      setSending(false)
    }
  }

  async function updateStatus(ticketId: string, status: string) {
    const res = await fetch(`/api/support/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setTickets(prev => prev.map(x => x.id === ticketId ? { ...x, status: status as SupportTicket['status'] } : x))
    }
  }

  let filtered = tickets
  if (filterStatus) filtered = filtered.filter(x => x.status === filterStatus)
  if (filterPriority) filtered = filtered.filter(x => x.priority === filterPriority)

  const openCount = tickets.filter(x => x.status === 'open' || x.status === 'in_progress').length

  // Unreviewed (anything not yet closed) vs. closed — kept in separate
  // sections so a long-resolved backlog doesn't bury what still needs
  // attention.
  const openFiltered = filtered.filter(x => x.status !== 'closed')
  const closedFiltered = filtered.filter(x => x.status === 'closed')

  const gridColsBase = ['1fr', '100px', '100px', ...(isCrossOrgViewer ? ['140px'] : []), ...(canManage ? ['140px'] : []), '80px']
  const gridTemplateColumns = gridColsBase.join(' ')
  const gridTemplateColumnsWithChevron = [...gridColsBase, '20px'].join(' ')
  const gridMinWidth = 360 + gridColsBase.reduce((sum, c) => sum + (c === '1fr' ? 0 : parseInt(c)), 0) + (gridColsBase.length - 1) * 12
  const gridMinWidthWithChevron = gridMinWidth + 32

  function renderTicketRow(ticket: SupportTicket) {
    const isExpanded = expandedId === ticket.id
    const createdByName = ticket.created_by_user?.full_name ?? (canManage ? getUserName(ticket.created_by) : t('me'))
    return (
      <div key={ticket.id} style={S.card}>
        {/* Row */}
        <div style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplateColumnsWithChevron,
              gap: 12, alignItems: 'center', cursor: 'pointer', minWidth: gridMinWidthWithChevron,
            }}
            onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--crm-text-primary)' }}>{ticket.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginTop: 2 }}>
                {t('messagesCount', { count: ticket.messages.length })}
              </div>
            </div>
            <Badge label={t(`priority.${ticket.priority}`)} color={PRIORITY_COLORS[ticket.priority] ?? '#6B7280'} />
            <Badge label={t(`status.${ticket.status}`)} color={STATUS_COLORS[ticket.status] ?? 'var(--crm-text-muted)'} />
            {isCrossOrgViewer && <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{ticket.organization?.name ?? '—'}</span>}
            {canManage && <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{createdByName}</span>}
            <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>{new Date(ticket.created_at).toLocaleDateString()}</span>
            {isExpanded ? <ChevronUp size={14} color="var(--crm-text-muted)" /> : <ChevronDown size={14} color="var(--crm-text-muted)" />}
          </div>
        </div>

        {/* Expanded thread */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid var(--crm-border)', marginTop: 16, paddingTop: 16 }}>
            {ticket.status !== 'closed' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22C55E', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  {t('live')}
                </span>
              </div>
            )}
            {/* Description */}
            <div style={{ backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{t('originalRequest')}</div>
              {ticket.description}
            </div>

            {/* Messages */}
            {ticket.messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {ticket.messages.map(msg => (
                  <div key={msg.id} style={{ backgroundColor: msg.created_by === user?.id ? '#6C63FF12' : 'var(--crm-surface-raised)', border: `1px solid ${msg.created_by === user?.id ? '#6C63FF30' : 'var(--crm-border)'}`, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginBottom: 6, fontWeight: 600 }}>
                      {msg.created_by === user?.id ? t('you') : (msg.author_name ?? (canManage ? getUserName(msg.created_by) : t('supportTeam')))} · {new Date(msg.created_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--crm-text-primary)', lineHeight: 1.6 }}>{msg.content}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Reply form */}
            {ticket.status !== 'closed' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  value={replyContent}
                  onChange={e => setReplyContent(e.target.value)}
                  onFocus={() => { /* keep expanded */ }}
                  placeholder={t('replyPlaceholder')}
                  rows={2}
                  style={{ ...S.input, resize: 'vertical', flex: 1 }}
                />
                <button
                  onClick={() => sendReply(ticket.id)}
                  disabled={sending || !replyContent.trim()}
                  style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', opacity: !replyContent.trim() ? 0.5 : 1 }}
                >
                  <Send size={13} /> {sending ? '…' : t('send')}
                </button>
              </div>
            )}

            {/* Status controls — only for support/admin_global roles */}
            {isCrossOrgViewer && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', alignSelf: 'center' }}>{t('changeStatus')}</span>
                {(['open', 'in_progress', 'closed'] as const).map(s => (
                  <button key={s} onClick={() => updateStatus(ticket.id, s)}
                    style={{
                      padding: '4px 12px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                      backgroundColor: ticket.status === s ? STATUS_COLORS[s] : 'var(--crm-surface-raised)',
                      color: ticket.status === s ? '#fff' : 'var(--crm-text-secondary)',
                    }}>
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>{t('title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
            {isCrossOrgViewer
              ? t('subtitleAllOrgs', { count: openCount })
              : isAdmin
              ? t('subtitleOrg', { count: openCount })
              : t('subtitleSdr')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchTickets} disabled={loading} style={{ ...S.btnGhost, display: 'flex', alignItems: 'center', padding: '7px 10px' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          {/* Support/admin_global don't belong to any org, so filing a
              ticket "for" an org doesn't make sense from this account. */}
          {!isCrossOrgViewer && (
            <button onClick={() => setShowNew(true)} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> {t('newTicket')}
            </button>
          )}
        </div>
      </div>

      {/* Audio-blocked fallback: the browser refused to play the arrival
          chime (no user gesture in this tab yet, or the context is still
          suspended), so say so visibly rather than dropping the alert. */}
      {mutedAlerts > 0 && (
        <div
          onClick={() => setMutedAlerts(0)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap', rowGap: 6, cursor: 'pointer',
            backgroundColor: '#F59E0B18', border: '1px solid #F59E0B44',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 13, color: '#FBBF24', fontWeight: 600 }}>
            {t('soundBlocked', { count: mutedAlerts })}
          </span>
          <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>{t('soundBlockedHint')}</span>
        </div>
      )}

      {/* Filters (admin/support/admin_global) */}
      {canManage && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value="">{t('allStatus')}</option>
            <option value="open">{t('status.open')}</option>
            <option value="in_progress">{t('status.in_progress')}</option>
            <option value="closed">{t('status.closed')}</option>
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value="">{t('allPriority')}</option>
            <option value="urgent">{t('priority.urgent')}</option>
            <option value="high">{t('priority.high')}</option>
            <option value="medium">{t('priority.medium')}</option>
            <option value="low">{t('priority.low')}</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', alignSelf: 'center' }}>{t('ticketsCount', { count: filtered.length })}</span>
        </div>
      )}

      {/* Table header */}
      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns, gap: 12, padding: '8px 16px', marginBottom: 4, minWidth: gridMinWidth }}>
            <span style={S.th}>{t('colSubject')}</span>
            <span style={S.th}>{t('colPriority')}</span>
            <span style={S.th}>{t('colStatus')}</span>
            {isCrossOrgViewer && <span style={S.th}>{t('colOrganization')}</span>}
            {canManage && <span style={S.th}>{t('colCreatedBy')}</span>}
            <span style={S.th}>{t('colDate')}</span>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--crm-text-muted)', padding: 48 }}>{tc('loading')}</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--crm-text-muted)', padding: 48, fontSize: 14 }}>
          {tickets.length === 0 ? t('noTicketsYet') : t('noTicketsMatch')}
        </div>
      )}

      {/* Ticket rows — split so a long-closed backlog never buries what
          still needs attention */}
      {!loading && filtered.length > 0 && (
        <>
          <div style={{ ...S.sectionHeading, margin: '4px 0 8px' }}>
            {t('sectionOpen', { count: openFiltered.length })}
          </div>
          {openFiltered.length === 0 && (
            <div style={{ color: 'var(--crm-text-muted)', fontSize: 13, padding: '8px 4px 20px' }}>{t('noOpenTickets')}</div>
          )}
          {openFiltered.map(renderTicketRow)}

          <div style={{ ...S.sectionHeading, margin: '20px 0 8px' }}>
            {t('sectionClosed', { count: closedFiltered.length })}
          </div>
          {closedFiltered.length === 0 && (
            <div style={{ color: 'var(--crm-text-muted)', fontSize: 13, padding: '8px 4px' }}>{t('noClosedTickets')}</div>
          )}
          {closedFiltered.map(renderTicketRow)}
        </>
      )}

      {/* New Ticket Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 480, maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t('newTicketTitle')}</h3>
              <button onClick={() => setShowNew(false)} aria-label={tc('close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>{t('colSubject')} *</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} style={S.input} placeholder={t('subjectPlaceholder')} />
              </div>
              <div>
                <label style={S.label}>{t('fieldDescription')} *</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...S.input, resize: 'vertical' }} placeholder={t('descriptionPlaceholder')} />
              </div>
              <div>
                <label style={S.label}>{t('colPriority')}</label>
                <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)} style={S.input}>
                  <option value="low">{t('priority.low')}</option>
                  <option value="medium">{t('priority.medium')}</option>
                  <option value="high">{t('priority.high')}</option>
                  <option value="urgent">{t('priority.urgent')}</option>
                </select>
              </div>

              {error && <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={createTicket} disabled={creating || !subject.trim() || !description.trim()}
                  style={{ ...S.btn, flex: 1, opacity: creating ? 0.7 : 1 }}>
                  {creating ? t('creating') : t('createTicket')}
                </button>
                <button onClick={() => setShowNew(false)} style={{ ...S.btnGhost, flex: 1 }}>{tc('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
