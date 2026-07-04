'use client'

import { useEffect, useState, useRef, useCallback, Fragment } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { SupportTicket, SupportTicketMessage } from '@/lib/types'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'

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

function playBeep(frequency = 880, duration = 150) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration / 1000)
  } catch { /* audio blocked */ }
}

function triggerAlert(priority: string) {
  if (priority === 'urgent') {
    document.body.style.backgroundColor = '#EF444415'
    setTimeout(() => { document.body.style.backgroundColor = '' }, 200)
    playBeep(880, 200)
    setTimeout(() => playBeep(1100, 150), 250)
  } else if (priority === 'high') {
    document.body.style.backgroundColor = '#F59E0B15'
    setTimeout(() => { document.body.style.backgroundColor = '' }, 200)
    playBeep(660, 150)
  }
}

export default function SupportPage() {
  const locale = useLocale()
  const router = useRouter()
  const { colors, t } = useGlobalAdminTheme()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, SupportTicketMessage[]>>({})
  const [msgLoading, setMsgLoading] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterOrg, setFilterOrg] = useState('all')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const initialLoadRef = useRef(true)

  const loadTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetch('/api/global-admin/tickets')
    const data = await res.json()
    const incoming: SupportTicket[] = Array.isArray(data) ? data : []

    if (!initialLoadRef.current) {
      for (const ticket of incoming) {
        if (!seenIdsRef.current.has(ticket.id) && (ticket.status === 'open' || ticket.status === 'in_progress')) {
          triggerAlert(ticket.priority)
          break
        }
      }
    }

    incoming.forEach(ticket => seenIdsRef.current.add(ticket.id))
    initialLoadRef.current = false

    setTickets(incoming)
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { loadTickets() }, [loadTickets])
  useEffect(() => {
    const interval = setInterval(() => loadTickets(true), 30000)
    return () => clearInterval(interval)
  }, [loadTickets])

  useEffect(() => {
    setReplyText('')
  }, [expandedTicketId])

  async function expandTicket(ticket: SupportTicket) {
    if (expandedTicketId === ticket.id) {
      setExpandedTicketId(null)
      return
    }
    setExpandedTicketId(ticket.id)
    if (!messages[ticket.id]) {
      setMsgLoading(ticket.id)
      const res = await fetch(`/api/global-admin/tickets/${ticket.id}/messages`)
      const data = await res.json()
      setMessages(prev => ({ ...prev, [ticket.id]: Array.isArray(data) ? data : [] }))
      setMsgLoading(null)
    }
  }

  useEffect(() => {
    if (expandedTicketId) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [expandedTicketId, messages])

  async function sendReply(ticketId: string) {
    if (!replyText.trim()) return
    setSending(true)
    const res = await fetch(`/api/global-admin/tickets/${ticketId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: replyText }),
    })
    if (res.ok) {
      const msg = await res.json()
      setMessages(prev => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), msg] }))
      setReplyText('')
    }
    setSending(false)
  }

  async function changeStatus(ticketId: string, status: string) {
    const res = await fetch(`/api/global-admin/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: status as SupportTicket['status'] } : t))
    }
  }

  function handleViewWorkspace(ticket: SupportTicket) {
    if (!ticket.organization_id) return
    setImpersonating(ticket.id)
    const orgName = ticket.organization?.name ?? ticket.organization_id
    router.push(`/${locale}/kanban?impersonate_org_id=${ticket.organization_id}&impersonate_org_name=${encodeURIComponent(orgName)}`)
  }

  const orgs = Array.from(new Set(tickets.map(t => t.organization?.name ?? t.organization_id).filter(Boolean)))
  const filtered = tickets.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (filterOrg !== 'all' && (t.organization?.name ?? t.organization_id) !== filterOrg) return false
    return true
  })

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: 13,
    color: colors.textPrimary,
    verticalAlign: 'middle',
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    color: colors.textPrimary,
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
  }

  return (
    <div>
      <style>{`
        @keyframes urgentPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          {t('support')}
          {openCount > 0 && (
            <span style={{ marginLeft: 10, fontSize: 13, backgroundColor: '#EF444420', color: '#EF4444', border: '1px solid #EF444440', borderRadius: 10, padding: '2px 10px', fontWeight: 600 }}>
              {openCount} {t('openTickets')}
            </span>
          )}
        </h1>
        <button onClick={() => loadTickets()} style={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, color: colors.textSecondary, borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">{t('allStatus')}</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} style={selectStyle}>
          <option value="all">{t('allOrgs')}</option>
          {orgs.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {loading && <div style={{ color: colors.textSecondary, textAlign: 'center', padding: 40 }}>{t('loading')}</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: colors.textMuted, textAlign: 'center', padding: 60, fontSize: 15 }}>{t('noTickets')}</div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[t('organization'), t('subject'), t('priority'), t('status'), t('created'), t('lastReply'), t('actions')].map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(ticket => {
                const isExpanded = expandedTicketId === ticket.id
                const ticketMsgs = messages[ticket.id] ?? []
                return (
                  <Fragment key={ticket.id}>
                    <tr
                      style={{
                        animation: ticket.priority === 'urgent' && ticket.status === 'open' ? 'urgentPulse 2s infinite' : 'none',
                        cursor: 'pointer',
                        backgroundColor: isExpanded ? colors.surfaceRaised : 'transparent',
                      }}
                      onClick={() => expandTicket(ticket)}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.backgroundColor = colors.surfaceRaised }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600, borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        {ticket.organization?.name ?? ticket.organization_id}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        {ticket.subject}
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        <span style={{
                          backgroundColor: (PRIORITY_COLORS[ticket.priority] ?? '#6B7280') + '22',
                          color: PRIORITY_COLORS[ticket.priority] ?? '#6B7280',
                          border: `1px solid ${PRIORITY_COLORS[ticket.priority] ?? '#6B7280'}44`,
                          borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                        }}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        <span style={{
                          backgroundColor: (STATUS_COLORS[ticket.status] ?? '#6B7280') + '22',
                          color: STATUS_COLORS[ticket.status] ?? '#6B7280',
                          border: `1px solid ${STATUS_COLORS[ticket.status] ?? '#6B7280'}44`,
                          borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600,
                        }}>
                          {ticket.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary, borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        {new Date(ticket.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ ...tdStyle, color: colors.textSecondary, borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }}>
                        {ticket.updated_at !== ticket.created_at ? new Date(ticket.updated_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', borderBottom: isExpanded ? 'none' : `1px solid ${colors.surfaceRaised}` }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => expandTicket(ticket)}
                            style={{
                              backgroundColor: `${colors.accent}22`, color: '#A78BFA',
                              border: `1px solid ${colors.accent}44`, borderRadius: 5,
                              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                            }}
                          >
                            {isExpanded ? '▲' : t('reply')}
                          </button>
                          <button
                            onClick={() => handleViewWorkspace(ticket)}
                            disabled={impersonating === ticket.id}
                            style={{
                              backgroundColor: '#F59E0B22', color: '#F59E0B',
                              border: '1px solid #F59E0B44', borderRadius: 5,
                              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                              opacity: impersonating === ticket.id ? 0.5 : 1,
                            }}
                          >
                            {t('viewWorkspace')}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {isExpanded && (
                      <tr key={`${ticket.id}-expanded`}>
                        <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${colors.border}` }}>
                          <div style={{ backgroundColor: colors.surfaceRaised, padding: '16px 20px' }}>
                            {/* Description */}
                            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
                              <strong style={{ color: colors.textPrimary }}>Description:</strong> {ticket.description}
                            </div>

                            {/* Status change + View workspace */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: colors.textSecondary }}>{t('changeStatus')}:</span>
                              {(['open', 'in_progress', 'resolved', 'closed'] as const).map(s => (
                                <button
                                  key={s}
                                  onClick={() => changeStatus(ticket.id, s)}
                                  style={{
                                    backgroundColor: ticket.status === s ? `${STATUS_COLORS[s]}22` : 'transparent',
                                    color: STATUS_COLORS[s],
                                    border: `1px solid ${STATUS_COLORS[s]}${ticket.status === s ? '66' : '33'}`,
                                    borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                                    fontWeight: ticket.status === s ? 700 : 400,
                                  }}
                                >
                                  {s.replace('_', ' ')}
                                </button>
                              ))}
                            </div>

                            {/* Messages thread */}
                            {msgLoading === ticket.id
                              ? <div style={{ color: colors.textMuted, padding: 20, textAlign: 'center' }}>{t('loading')}</div>
                              : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 300, overflowY: 'auto' }}>
                                  {ticketMsgs.length === 0
                                    ? <div style={{ color: colors.textMuted, fontSize: 13 }}>No messages yet.</div>
                                    : ticketMsgs.map(msg => (
                                      <div key={msg.id} style={{
                                        backgroundColor: colors.surface,
                                        border: `1px solid ${colors.border}`,
                                        borderRadius: 8, padding: '10px 14px',
                                      }}>
                                        <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>
                                          {msg.author?.full_name ?? 'Unknown'} · {new Date(msg.created_at).toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 1.5 }}>{msg.content}</div>
                                      </div>
                                    ))
                                  }
                                  <div ref={messagesEndRef} />
                                </div>
                              )
                            }

                            {/* Reply box */}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <textarea
                                value={replyText}
                                onChange={e => setReplyText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(ticket.id) }}
                                rows={2}
                                placeholder="Type a reply… (⌘↵ to send)"
                                style={{
                                  flex: 1,
                                  backgroundColor: colors.surface,
                                  border: `1px solid ${colors.border}`,
                                  color: colors.textPrimary,
                                  borderRadius: 6,
                                  padding: '8px 10px',
                                  fontSize: 13,
                                  resize: 'none',
                                  outline: 'none',
                                }}
                              />
                              <button
                                onClick={() => sendReply(ticket.id)}
                                disabled={sending || !replyText.trim()}
                                style={{
                                  backgroundColor: colors.accent, color: '#fff',
                                  border: 'none', borderRadius: 6, padding: '8px 16px',
                                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                  opacity: sending || !replyText.trim() ? 0.5 : 1,
                                  alignSelf: 'flex-end',
                                }}
                              >
                                {sending ? '…' : t('sendReply')}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
