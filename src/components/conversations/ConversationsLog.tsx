'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import { logAuditEvent } from '@/lib/utils/audit'

interface ConvRow {
  id: string
  prospect_id: string
  author_id: string
  author_name: string
  chat_content: string
  reason: string
  created_at: string
}

interface Props {
  prospectId: string
  prospectName: string
  isClosed?: boolean
}

export function ConversationsLog({ prospectId, prospectName, isClosed = false }: Props) {
  const t = useTranslations('convertidos')
  const tc = useTranslations('common')
  const { isAdmin } = useUser()
  const [convs, setConvs] = useState<ConvRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [chatContent, setChatContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/conversations?prospect_id=${prospectId}`)
    if (res.ok) setConvs(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [prospectId])

  async function handleSave() {
    if (!chatContent.trim()) return
    setSaving(true)
    setError('')
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospect_id: prospectId, chat_content: chatContent, reason: '' }),
    })
    if (res.ok) {
      await logAuditEvent({ event_type: 'conversation_added', prospect_id: prospectId, prospect_name: prospectName, metadata: {} })
      setChatContent('')
      setAddOpen(false)
      load()
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? t('errorSaving'))
    }
    setSaving(false)
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('salesChatsTitle')} {convs.length > 0 && <span style={{ fontSize: 11, backgroundColor: '#6C63FF20', color: 'var(--crm-accent)', borderRadius: 10, padding: '1px 7px', marginLeft: 6 }}>{convs.length}</span>}
        </span>
        <button
          onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: 'var(--crm-accent)', color: '#FFF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Plus size={12} /> {t('uploadChat')}
        </button>
      </div>

      {loading && <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{tc('loading')}</p>}
      {!loading && convs.length === 0 && <p style={{ color: 'var(--crm-text-muted)', fontSize: 13 }}>{t('noChatsUploaded')}</p>}

      {convs.map(c => {
        const isExp = expanded.has(c.id)
        return (
          <div key={c.id} style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                <span style={{ fontWeight: 600 }}>{c.author_name}</span>
                <span style={{ color: 'var(--crm-text-muted)', marginLeft: 10, fontFamily: 'monospace' }}>
                  {format(new Date(c.created_at), 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
              <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}>
                {isExp ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--crm-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {isExp ? c.chat_content : (c.chat_content.length > 120 ? c.chat_content.slice(0, 120) + '…' : c.chat_content)}
            </div>
          </div>
        )
      })}

      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--crm-text-primary)' }}>{t('addSalesChat')}</h3>
                <div style={{ fontSize: 13, color: 'var(--crm-text-muted)', marginTop: 4 }}>{prospectName}</div>
              </div>
              <button onClick={() => { setAddOpen(false); setChatContent(''); setError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', flexShrink: 0 }}><X size={16} /></button>
            </div>
            <label style={{ fontSize: 12, color: 'var(--crm-text-muted)', display: 'block', marginBottom: 6 }}>{t('pasteConversationLabel')}</label>
            <textarea
              value={chatContent}
              onChange={e => setChatContent(e.target.value)}
              rows={14}
              placeholder={t('conversationPlaceholder')}
              style={{ width: '100%', backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, padding: '10px 12px', color: 'var(--crm-text-primary)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {error && <p style={{ color: '#EF4444', fontSize: 12, margin: '8px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setAddOpen(false); setChatContent(''); setError('') }} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer', fontSize: 13 }}>
                {tc('cancel')}
              </button>
              <button onClick={handleSave} disabled={saving || !chatContent.trim()} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: saving || !chatContent.trim() ? 'var(--crm-border)' : 'var(--crm-accent)', color: '#FFF', cursor: saving || !chatContent.trim() ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {saving ? tc('saving') : t('saveChat')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
