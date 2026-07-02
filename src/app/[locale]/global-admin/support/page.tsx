'use client'

import { useEffect, useState, useRef } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { SupportTicket, SupportTicketMessage } from '@/lib/types'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#6B7280',
}

const STATUS_COLORS: Record<string, string> = {
  open: '#3B82F6',
  in_progress: '#8B5CF6',
  resolved: '#22C55E',
  closed: '#6B7280',
}

export default function SupportPage() {
  const locale = useLocale()
  const router = useRouter()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadTickets()
  }, [])

  async function loadTickets() {
    setLoading(true)
    const res = await fetch('/api/global-admin/tickets')
    const data = await res.json()
    setTickets(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function openTicket(ticket: SupportTicket) {
    setSelectedTicket(ticket)
    setMsgLoading(true)
    setMessages([])
    const res = await fetch(`/api/global-admin/tickets/${ticket.id}/messages`)
    const data = await res.json()
    setMessages(Array.isArray(data) ? data : [])
    setMsgLoading(false)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendReply() {
    if (!selectedTicket || !replyText.trim()) return
    setSending(true)
    const res = await fetch(`/api/global-admin/tickets/${selectedTicket.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: replyText }),
    })
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
      setReplyText('')
    }
    setSending(false)
  }

  async function markResolved() {
    if (!selectedTicket) return
    await fetch(`/api/global-admin/tickets/${selectedTicket.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    setSelectedTicket(prev => prev ? { ...prev, status: 'resolved' } : null)
    setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: 'resolved' } : t))
  }

  async function handleViewWorkspace(ticket: SupportTicket) {
    if (!ticket.organization_id) return
    setImpersonating(ticket.id)
    const orgName = ticket.organization?.name ?? ticket.organization_id
    const res = await fetch('/api/global-admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: ticket.organization_id, org_name: orgName }),
    })
    if (res.ok) {
      router.push(`/${locale}/kanban`)
    } else {
      setImpersonating(null)
    }
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#52526A',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid #2A2A3A',
    whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: 13,
    color: '#F0F0F5',
    borderBottom: '1px solid #1C1C27',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ padding: 32, display: 'flex', gap: 24, height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Left: ticket list */}
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <style>{`
          @keyframes urgentPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
            50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
          }
        `}</style>

        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0F0F5', marginBottom: 24 }}>Support</h1>

        {loading && <div style={{ color: '#8B8BA0', textAlign: 'center', padding: 40 }}>Loading…</div>}

        {!loading && tickets.length === 0 && (
          <div style={{ color: '#52526A', textAlign: 'center', padding: 60, fontSize: 15 }}>
            No support tickets.
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Organization', 'Subject', 'Priority', 'Status', 'Created', 'Actions'].map(col => (
                    <th key={col} style={thStyle}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(ticket => (
                  <tr
                    key={ticket.id}
                    style={{
                      animation: ticket.priority === 'urgent' ? 'urgentPulse 2s infinite' : 'none',
                      cursor: 'default',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {ticket.organization?.name ?? ticket.organization_id}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ticket.subject}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        backgroundColor: (PRIORITY_COLORS[ticket.priority] ?? '#6B7280') + '22',
                        color: PRIORITY_COLORS[ticket.priority] ?? '#6B7280',
                        border: `1px solid ${PRIORITY_COLORS[ticket.priority] ?? '#6B7280'}44`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        backgroundColor: (STATUS_COLORS[ticket.status] ?? '#6B7280') + '22',
                        color: STATUS_COLORS[ticket.status] ?? '#6B7280',
                        border: `1px solid ${STATUS_COLORS[ticket.status] ?? '#6B7280'}44`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                      }}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#8B8BA0' }}>
                      {new Date(ticket.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => openTicket(ticket)}
                        style={{
                          backgroundColor: '#6C63FF22',
                          color: '#A78BFA',
                          border: '1px solid #6C63FF44',
                          borderRadius: 5,
                          padding: '4px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Reply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right: reply panel */}
      {selectedTicket && (
        <div style={{
          width: 380,
          backgroundColor: '#13131A',
          border: '1px solid #2A2A3A',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A3A' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F5', flex: 1, marginRight: 8 }}>
                {selectedTicket.subject}
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#52526A', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#52526A', marginBottom: 8 }}>
              {selectedTicket.organization?.name ?? selectedTicket.organization_id}
            </div>
            <div style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.5 }}>
              {selectedTicket.description}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msgLoading && <div style={{ color: '#52526A', textAlign: 'center', padding: 20 }}>Loading…</div>}
            {messages.map(msg => (
              <div key={msg.id} style={{
                backgroundColor: '#1C1C27',
                border: '1px solid #2A2A3A',
                borderRadius: 8,
                padding: 12,
              }}>
                <div style={{ fontSize: 11, color: '#52526A', marginBottom: 4 }}>
                  {msg.author?.full_name ?? 'Unknown'} · {new Date(msg.created_at).toLocaleString()}
                </div>
                <div style={{ fontSize: 13, color: '#F0F0F5', lineHeight: 1.5 }}>{msg.content}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply area */}
          <div style={{ padding: 14, borderTop: '1px solid #2A2A3A', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={3}
              placeholder="Type a reply…"
              style={{
                backgroundColor: '#1C1C27',
                border: '1px solid #2A2A3A',
                color: '#F0F0F5',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 13,
                resize: 'none',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim()}
                style={{
                  flex: 1,
                  backgroundColor: '#6C63FF',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: sending || !replyText.trim() ? 0.5 : 1,
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button
                onClick={markResolved}
                disabled={selectedTicket.status === 'resolved'}
                style={{
                  backgroundColor: '#22C55E22',
                  color: '#22C55E',
                  border: '1px solid #22C55E44',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  opacity: selectedTicket.status === 'resolved' ? 0.5 : 1,
                }}
              >
                ✓ Resolved
              </button>
              <button
                onClick={() => handleViewWorkspace(selectedTicket)}
                disabled={impersonating === selectedTicket.id}
                style={{
                  backgroundColor: '#F59E0B22',
                  color: '#F59E0B',
                  border: '1px solid #F59E0B44',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  opacity: impersonating === selectedTicket.id ? 0.5 : 1,
                }}
              >
                View WS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
