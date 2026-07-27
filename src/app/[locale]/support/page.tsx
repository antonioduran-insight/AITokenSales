'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
    return found?.full_name ?? 'Unknown'
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
    for (const t of ticketsRef.current) {
      if (t.created_by === userId && t.created_by_user?.full_name) return t.created_by_user.full_name
      const found = t.messages.find(m => m.created_by === userId && m.author_name)
      if (found?.author_name) return found.author_name
    }
    return canManage ? getUserName(userId) : 'Support'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  // Realtime subscription for expanded ticket messages (only when not closed)
  useEffect(() => {
    if (!expandedId) return
    const expandedTicket = tickets.find(t => t.id === expandedId)
    if (expandedTicket?.status === 'closed') return
    const supabase = createClient()
    const channel = supabase
      .channel(`ticket-messages-${expandedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_ticket_messages', filter: `ticket_id=eq.${expandedId}` },
        (payload) => {
          const newMsg = payload.new as TicketMessage
          setTickets(prev => prev.map(t => {
            if (t.id !== expandedId) return t
            if (t.messages.some(m => m.id === newMsg.id)) return t
            const enriched = newMsg.created_by === user?.id ? newMsg : { ...newMsg, author_name: resolveAuthorName(newMsg.created_by) }
            return { ...t, messages: [...t.messages, enriched] }
          }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [expandedId, tickets, user?.id, resolveAuthorName])

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

  // Browsers block audio until the page has seen a real user gesture — grab
  // one on first click/keypress anywhere so the AudioContext is ready by
  // the time a ticket actually arrives.
  const audioCtxRef = useRef<AudioContext | null>(null)
  useEffect(() => {
    function unlock() {
      if (!audioCtxRef.current) {
        try { audioCtxRef.current = new AudioContext() } catch { /* unsupported */ }
      } else if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  function playNotificationSound() {
    const ctx = audioCtxRef.current
    if (!ctx) return
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
    } catch { /* ignore — sound is a nicety, not critical */ }
  }

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
  }, [fetchTicketsSilent, isCrossOrgViewer])

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
    if (!subject.trim() || !description.trim()) { setError('Subject and description are required'); return }
    setCreating(true); setError(null)
    const res = await fetch('/api/support/tickets', {
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
      setTickets(prev => prev.map(t => t.id === ticketId
        ? { ...t, messages: [...t.messages.filter(m => m.id !== data.id), data] }
        : t
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
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: status as SupportTicket['status'] } : t))
    }
  }

  let filtered = tickets
  if (filterStatus) filtered = filtered.filter(t => t.status === filterStatus)
  if (filterPriority) filtered = filtered.filter(t => t.priority === filterPriority)

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length

  // Unreviewed (anything not yet closed) vs. closed — kept in separate
  // sections so a long-resolved backlog doesn't bury what still needs
  // attention.
  const openFiltered = filtered.filter(t => t.status !== 'closed')
  const closedFiltered = filtered.filter(t => t.status === 'closed')

  const gridColsBase = ['1fr', '100px', '100px', ...(isCrossOrgViewer ? ['140px'] : []), ...(canManage ? ['140px'] : []), '80px']
  const gridTemplateColumns = gridColsBase.join(' ')
  const gridTemplateColumnsWithChevron = [...gridColsBase, '20px'].join(' ')
  const gridMinWidth = 360 + gridColsBase.reduce((sum, c) => sum + (c === '1fr' ? 0 : parseInt(c)), 0) + (gridColsBase.length - 1) * 12
  const gridMinWidthWithChevron = gridMinWidth + 32

  function renderTicketRow(ticket: SupportTicket) {
    const isExpanded = expandedId === ticket.id
    const createdByName = ticket.created_by_user?.full_name ?? (canManage ? getUserName(ticket.created_by) : 'Me')
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
                {ticket.messages.length} message{ticket.messages.length !== 1 ? 's' : ''}
              </div>
            </div>
            <Badge label={ticket.priority} color={PRIORITY_COLORS[ticket.priority] ?? '#6B7280'} />
            <Badge label={ticket.status.replace('_', ' ')} color={STATUS_COLORS[ticket.status] ?? 'var(--crm-text-muted)'} />
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
                  Live
                </span>
              </div>
            )}
            {/* Description */}
            <div style={{ backgroundColor: 'var(--crm-surface-raised)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13, color: 'var(--crm-text-secondary)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, marginBottom: 6 }}>ORIGINAL REQUEST</div>
              {ticket.description}
            </div>

            {/* Messages */}
            {ticket.messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {ticket.messages.map(msg => (
                  <div key={msg.id} style={{ backgroundColor: msg.created_by === user?.id ? '#6C63FF12' : 'var(--crm-surface-raised)', border: `1px solid ${msg.created_by === user?.id ? '#6C63FF30' : 'var(--crm-border)'}`, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginBottom: 6, fontWeight: 600 }}>
                      {msg.created_by === user?.id ? 'You' : (msg.author_name ?? (canManage ? getUserName(msg.created_by) : 'Support'))} · {new Date(msg.created_at).toLocaleString()}
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
                  placeholder="Type a reply..."
                  rows={2}
                  style={{ ...S.input, resize: 'vertical', flex: 1 }}
                />
                <button
                  onClick={() => sendReply(ticket.id)}
                  disabled={sending || !replyContent.trim()}
                  style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', opacity: !replyContent.trim() ? 0.5 : 1 }}
                >
                  <Send size={13} /> {sending ? '…' : 'Send'}
                </button>
              </div>
            )}

            {/* Status controls — only for support/admin_global roles */}
            {isCrossOrgViewer && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', alignSelf: 'center' }}>Change status:</span>
                {(['open', 'in_progress', 'closed'] as const).map(s => (
                  <button key={s} onClick={() => updateStatus(ticket.id, s)}
                    style={{
                      padding: '4px 12px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                      backgroundColor: ticket.status === s ? STATUS_COLORS[s] : 'var(--crm-surface-raised)',
                      color: ticket.status === s ? '#fff' : 'var(--crm-text-secondary)',
                    }}>
                    {s.replace('_', ' ')}
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
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Support</h1>
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
            {isCrossOrgViewer
              ? `${openCount} open ticket${openCount !== 1 ? 's' : ''} across all organizations`
              : isAdmin
              ? `${openCount} open ticket${openCount !== 1 ? 's' : ''} across your organization`
              : 'Submit and track your support requests'}
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
              <Plus size={14} /> New Ticket
            </button>
          )}
        </div>
      </div>

      {/* Filters (admin/support/admin_global) */}
      {canManage && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="closed">Closed</option>
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value="">All Priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', alignSelf: 'center' }}>{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Table header */}
      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns, gap: 12, padding: '8px 16px', marginBottom: 4, minWidth: gridMinWidth }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
            {isCrossOrgViewer && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organization</span>}
            {canManage && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created by</span>}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--crm-text-muted)', padding: 48 }}>Loading tickets…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--crm-text-muted)', padding: 48, fontSize: 14 }}>
          {tickets.length === 0 ? 'No tickets yet. Everything is good! 🎉' : 'No tickets match the current filters.'}
        </div>
      )}

      {/* Ticket rows — split so a long-closed backlog never buries what
          still needs attention */}
      {!loading && filtered.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 8px' }}>
            Open ({openFiltered.length})
          </div>
          {openFiltered.length === 0 && (
            <div style={{ color: 'var(--crm-text-muted)', fontSize: 13, padding: '8px 4px 20px' }}>No open tickets.</div>
          )}
          {openFiltered.map(renderTicketRow)}

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '20px 0 8px' }}>
            Closed ({closedFiltered.length})
          </div>
          {closedFiltered.length === 0 && (
            <div style={{ color: 'var(--crm-text-muted)', fontSize: 13, padding: '8px 4px' }}>No closed tickets.</div>
          )}
          {closedFiltered.map(renderTicketRow)}
        </>
      )}

      {/* New Ticket Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28, width: 480, maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>New Support Ticket</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={S.label}>Subject *</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} style={S.input} placeholder="Brief description of the issue" />
              </div>
              <div>
                <label style={S.label}>Description *</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} style={{ ...S.input, resize: 'vertical' }} placeholder="Describe the issue in detail…" />
              </div>
              <div>
                <label style={S.label}>Priority</label>
                <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)} style={S.input}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {error && <p style={{ color: '#EF4444', fontSize: 12, margin: 0 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={createTicket} disabled={creating || !subject.trim() || !description.trim()}
                  style={{ ...S.btn, flex: 1, opacity: creating ? 0.7 : 1 }}>
                  {creating ? 'Creating…' : 'Create Ticket'}
                </button>
                <button onClick={() => setShowNew(false)} style={{ ...S.btnGhost, flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
