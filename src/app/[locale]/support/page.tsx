'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { Plus, X, ChevronDown, ChevronUp, Send, RefreshCw } from 'lucide-react'

interface TicketMessage {
  id: string
  ticket_id: string
  created_by: string
  content: string
  created_at: string
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
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}
const STATUS_COLORS: Record<string, string> = {
  open: '#6C63FF', in_progress: '#F59E0B', resolved: '#22C55E', closed: '#52526A',
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: '#F0F0F5', maxWidth: 900 },
  card: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: 20, marginBottom: 12 },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 7, color: '#F0F0F5', padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const },
  label: { fontSize: 12, color: '#8B8BA0', fontWeight: 600, display: 'block', marginBottom: 6 },
  btn: { backgroundColor: '#6C63FF', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { backgroundColor: 'transparent', color: '#8B8BA0', border: '1px solid #2A2A3A', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
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

  // Realtime subscription for expanded ticket messages
  useEffect(() => {
    if (!expandedId) return
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
            return { ...t, messages: [...t.messages, newMsg] }
          }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [expandedId])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/support/tickets')
      const data = await res.json()
      setTickets(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTickets() }, [fetchTickets])

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
    const res = await fetch(`/api/support/tickets/${ticketId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: replyContent }),
    })
    if (res.ok) {
      const msg = await res.json()
      setTickets(prev => prev.map(t => t.id === ticketId
        ? { ...t, messages: [...t.messages, msg] }
        : t
      ))
      setReplyContent('')
    }
    setSending(false)
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

  const getUserName = (userId: string) => {
    const found = orgUsers.find(u => u.id === userId)
    return found?.full_name ?? 'Unknown'
  }

  let filtered = tickets
  if (filterStatus) filtered = filtered.filter(t => t.status === filterStatus)
  if (filterPriority) filtered = filtered.filter(t => t.priority === filterPriority)

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Support</h1>
          <p style={{ fontSize: 13, color: '#52526A', margin: 0 }}>
            {isAdmin
              ? `${openCount} open ticket${openCount !== 1 ? 's' : ''} across your organization`
              : 'Submit and track your support requests'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchTickets} disabled={loading} style={{ ...S.btnGhost, display: 'flex', alignItems: 'center', padding: '7px 10px' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button onClick={() => setShowNew(true)} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> New Ticket
          </button>
        </div>
      </div>

      {/* Filters (admin only) */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '6px 10px' }}>
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
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
          <span style={{ fontSize: 12, color: '#52526A', alignSelf: 'center' }}>{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Table header */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 100px 100px 140px 80px' : '1fr 100px 100px 80px', gap: 12, padding: '8px 16px', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
          {isAdmin && <span style={{ fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created by</span>}
          <span style={{ fontSize: 11, fontWeight: 600, color: '#52526A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', color: '#52526A', padding: 48 }}>Loading tickets…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: '#52526A', padding: 48, fontSize: 14 }}>
          {tickets.length === 0 ? 'No tickets yet. Everything is good! 🎉' : 'No tickets match the current filters.'}
        </div>
      )}

      {/* Ticket rows */}
      {!loading && filtered.map(ticket => {
        const isExpanded = expandedId === ticket.id
        const createdByName = ticket.created_by_user?.full_name ?? (isAdmin ? getUserName(ticket.created_by) : 'Me')
        return (
          <div key={ticket.id} style={S.card}>
            {/* Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isAdmin ? '1fr 100px 100px 140px 80px 20px' : '1fr 100px 100px 80px 20px',
                gap: 12, alignItems: 'center', cursor: 'pointer',
              }}
              onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5' }}>{ticket.subject}</div>
                <div style={{ fontSize: 12, color: '#52526A', marginTop: 2 }}>
                  {ticket.messages.length} message{ticket.messages.length !== 1 ? 's' : ''}
                </div>
              </div>
              <Badge label={ticket.priority} color={PRIORITY_COLORS[ticket.priority] ?? '#6B7280'} />
              <Badge label={ticket.status.replace('_', ' ')} color={STATUS_COLORS[ticket.status] ?? '#52526A'} />
              {isAdmin && <span style={{ fontSize: 13, color: '#8B8BA0' }}>{createdByName}</span>}
              <span style={{ fontSize: 12, color: '#52526A' }}>{new Date(ticket.created_at).toLocaleDateString()}</span>
              {isExpanded ? <ChevronUp size={14} color="#52526A" /> : <ChevronDown size={14} color="#52526A" />}
            </div>

            {/* Expanded thread */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #2A2A3A', marginTop: 16, paddingTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22C55E', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    Live
                  </span>
                </div>
                {/* Description */}
                <div style={{ backgroundColor: '#1C1C27', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13, color: '#8B8BA0', lineHeight: 1.6 }}>
                  <div style={{ fontSize: 11, color: '#52526A', fontWeight: 600, marginBottom: 6 }}>ORIGINAL REQUEST</div>
                  {ticket.description}
                </div>

                {/* Messages */}
                {ticket.messages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {ticket.messages.map(msg => (
                      <div key={msg.id} style={{ backgroundColor: msg.created_by === user?.id ? '#6C63FF12' : '#1C1C27', border: `1px solid ${msg.created_by === user?.id ? '#6C63FF30' : '#2A2A3A'}`, borderRadius: 8, padding: '10px 14px' }}>
                        <div style={{ fontSize: 11, color: '#52526A', marginBottom: 6, fontWeight: 600 }}>
                          {msg.created_by === user?.id ? 'You' : (isAdmin ? getUserName(msg.created_by) : 'Support')} · {new Date(msg.created_at).toLocaleString()}
                        </div>
                        <div style={{ fontSize: 13, color: '#F0F0F5', lineHeight: 1.6 }}>{msg.content}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply form */}
                {(ticket.status !== 'closed' && ticket.status !== 'resolved') && (
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
                {(user?.role === 'support' || user?.role === 'admin_global') && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#52526A', alignSelf: 'center' }}>Change status:</span>
                    {(['open', 'in_progress', 'resolved', 'closed'] as const).map(s => (
                      <button key={s} onClick={() => updateStatus(ticket.id, s)}
                        style={{
                          padding: '4px 12px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                          backgroundColor: ticket.status === s ? STATUS_COLORS[s] : '#1C1C27',
                          color: ticket.status === s ? '#fff' : '#8B8BA0',
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
      })}

      {/* New Ticket Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 28, width: 480, maxWidth: '92vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>New Support Ticket</h3>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}><X size={16} /></button>
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
