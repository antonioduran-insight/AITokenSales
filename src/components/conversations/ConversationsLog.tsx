'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { format } from 'date-fns'
import { MessageSquare, Plus, X, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUser } from '@/contexts/UserContext'
import type { Conversation, User } from '@/lib/types'

interface Props {
  prospectId: string
  prospectName: string
  isClosed?: boolean
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

export function ConversationsLog({ prospectId, prospectName, isClosed = false }: Props) {
  const t = useTranslations('conversations')
  const { isAdmin } = useUser()
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

  // First upload: no reason required; subsequent: reason required
  const isFirstUpload = conversations.length === 0
  const canSave = isFirstUpload
    ? chatContent.trim().length > 0
    : reason.trim().length > 0 && chatContent.trim().length > 0

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { data: userData } = await supabase.from('users').select('full_name').eq('id', user.id).single()

    const finalReason = isFirstUpload
      ? t('firstUploadHint')
      : reason.trim()

    const { error } = await supabase.from('conversations').insert({
      prospect_id: prospectId,
      author_id: user.id,
      chat_content: chatContent.trim(),
      reason: finalReason,
    })

    if (!error) {
      await logAuditEvent({
        event_type: 'conversation_added',
        prospect_id: prospectId,
        prospect_name: prospectName,
        metadata: {
          reason: finalReason,
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
      {/* Mandatory alert for closed leads with no chat — only for SDRs */}
      {isClosed && !isAdmin && conversations.length === 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 8, marginBottom: 14,
          backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40',
        }}>
          <AlertTriangle size={14} color="#F59E0B" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#F59E0B' }}>{t('closedAlert')}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={14} color="#6C63FF" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#8B8BA0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('title')}
          </span>
          {conversations.length > 0 && (
            <span style={{ fontSize: 11, backgroundColor: '#6C63FF20', color: '#6C63FF', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
              {conversations.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #6C63FF40', backgroundColor: isClosed && !isAdmin && conversations.length === 0 ? '#6C63FF' : '#6C63FF15', color: isClosed && !isAdmin && conversations.length === 0 ? '#FFF' : '#6C63FF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Plus size={12} /> {t('addChat')}
        </button>
      </div>

      {/* List */}
      {conversations.length === 0 ? (
        <p style={{ color: '#52526A', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          {t('noData')}
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

              <div style={{ fontSize: 12, color: '#6C63FF', marginBottom: 6, fontStyle: 'italic' }}>
                "{c.reason}"
              </div>

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
                  {t('viewFull')}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>
                {isFirstUpload ? t('firstUploadHint') : t('anotherChatTitle')}
              </h3>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                <X size={16} />
              </button>
            </div>

            {/* Reason — only shown on 2nd+ upload */}
            {!isFirstUpload && (
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>{t('reason')} <span style={{ color: '#EF4444' }}>*</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value.slice(0, 200))}
                  placeholder={t('reasonPlaceholder')}
                  rows={2}
                  style={S.textarea}
                />
                <div style={{ fontSize: 11, color: reason.length > 180 ? '#F59E0B' : '#52526A', textAlign: 'right', marginTop: 4 }}>
                  {reason.length}/200
                </div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>{t('chat')} <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea
                value={chatContent}
                onChange={e => setChatContent(e.target.value)}
                placeholder={t('chatPlaceholder')}
                rows={10}
                style={S.textarea}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => setAddOpen(false)} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !canSave}
                style={{ flex: 1, backgroundColor: '#6C63FF', color: '#FFF' }}
              >
                {saving ? t('saving') : t('save')}
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
