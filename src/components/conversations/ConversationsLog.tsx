'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { format } from 'date-fns'
import { MessageSquare, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Conversation, User } from '@/lib/types'

interface Props {
  prospectId: string
  prospectName: string
}

const S: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1C1C27',
    border: '1px solid #2A2A3A',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    color: '#52526A',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 6,
  },
  textarea: {
    width: '100%',
    backgroundColor: '#13131A',
    border: '1px solid #2A2A3A',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#F0F0F5',
    fontSize: 13,
    resize: 'vertical' as const,
    outline: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    boxSizing: 'border-box' as const,
  },
}

export function ConversationsLog({ prospectId, prospectName }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [viewFull, setViewFull] = useState<Conversation | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [chatContent, setChatContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function fetchConversations() {
    const { data } = await createClient()
      .from('conversations')
      .select('*, author:users!author_id(id, full_name, email, role, area_id, is_active, created_at)')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: false })
    if (data) setConversations(data as unknown as Conversation[])
  }

  useEffect(() => { fetchConversations() }, [prospectId])

  async function handleSave() {
    if (!reason.trim() || !chatContent.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { data: userData } = await supabase.from('users').select('full_name').eq('id', user.id).single()

    const { error } = await supabase.from('conversations').insert({
      prospect_id: prospectId,
      author_id: user.id,
      chat_content: chatContent.trim(),
      reason: reason.trim(),
    })

    if (!error) {
      await logAuditEvent({
        event_type: 'conversation_added',
        prospect_id: prospectId,
        prospect_name: prospectName,
        metadata: {
          reason: reason.trim(),
          author: userData?.full_name ?? user.email ?? 'Unknown',
        },
      })
      setReason('')
      setChatContent('')
      setAddOpen(false)
      fetchConversations()
    }
    setSaving(false)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={14} color="#6C63FF" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#8B8BA0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Conversations
          </span>
          {conversations.length > 0 && (
            <span style={{ fontSize: 11, backgroundColor: '#6C63FF20', color: '#6C63FF', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
              {conversations.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #6C63FF40', backgroundColor: '#6C63FF15', color: '#6C63FF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* List */}
      {conversations.length === 0 ? (
        <p style={{ color: '#52526A', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          No conversations yet
        </p>
      ) : (
        conversations.map(c => {
          const author = c.author as User | undefined
          const isExpanded = expanded.has(c.id)
          return (
            <div key={c.id} style={S.card}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#8B8BA0' }}>{author?.full_name ?? '—'}</span>
                  <span style={{ fontSize: 11, color: '#52526A', marginLeft: 8, fontFamily: 'JetBrains Mono, monospace' }}>
                    {format(new Date(c.created_at), 'dd MMM yyyy, HH:mm')}
                  </span>
                </div>
                <button
                  onClick={() => toggleExpand(c.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A', padding: 2, flexShrink: 0 }}
                >
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>

              {/* Reason */}
              <div style={{ fontSize: 12, color: '#6C63FF', marginBottom: 6, fontStyle: 'italic' }}>
                "{c.reason}"
              </div>

              {/* Chat preview / full */}
              <div style={{ fontSize: 13, color: '#8B8BA0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {isExpanded ? c.chat_content : (
                  c.chat_content.length > 100 ? c.chat_content.slice(0, 100) + '…' : c.chat_content
                )}
              </div>

              {!isExpanded && c.chat_content.length > 100 && (
                <button
                  onClick={() => setViewFull(c)}
                  style={{ marginTop: 6, fontSize: 11, color: '#6C63FF', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Ver completo
                </button>
              )}
            </div>
          )
        })
      )}

      {/* Add modal */}
      {addOpen && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setAddOpen(false) }}
        >
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 520, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>Add Conversation</h3>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Why are you uploading this? <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value.slice(0, 200))}
                placeholder="Ej: Conversación de calificación inicial, seguimiento post-demo…"
                rows={2}
                style={S.textarea}
              />
              <div style={{ fontSize: 11, color: reason.length > 180 ? '#F59E0B' : '#52526A', textAlign: 'right', marginTop: 4 }}>
                {reason.length}/200
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Paste the full chat <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea
                value={chatContent}
                onChange={e => setChatContent(e.target.value)}
                placeholder="Pega aquí la conversación completa…"
                rows={10}
                style={S.textarea}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                onClick={() => setAddOpen(false)}
                style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !reason.trim() || !chatContent.trim()}
                style={{ flex: 1, backgroundColor: '#6C63FF', color: '#FFF' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View full modal */}
      {viewFull && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setViewFull(null) }}
        >
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 600, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F5' }}>
                  {(viewFull.author as User | undefined)?.full_name ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: '#52526A', marginTop: 2 }}>
                  {format(new Date(viewFull.created_at), 'dd MMM yyyy, HH:mm')}
                </div>
              </div>
              <button onClick={() => setViewFull(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6C63FF', fontStyle: 'italic', marginBottom: 14, padding: '6px 10px', backgroundColor: '#6C63FF10', borderRadius: 6 }}>
              "{viewFull.reason}"
            </div>
            <div style={{ fontSize: 13, color: '#F0F0F5', lineHeight: 1.7, whiteSpace: 'pre-wrap', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 8, padding: '12px 14px' }}>
              {viewFull.chat_content}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
