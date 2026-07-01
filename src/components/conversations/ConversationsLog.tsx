'use client'

import { useState, useEffect } from 'react'
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
      setError(body.error ?? 'Error al guardar')
    }
    setSaving(false)
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#8B8BA0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Chats de venta {convs.length > 0 && <span style={{ fontSize: 11, backgroundColor: '#6C63FF20', color: '#6C63FF', borderRadius: 10, padding: '1px 7px', marginLeft: 6 }}>{convs.length}</span>}
        </span>
        <button
          onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: '#6C63FF', color: '#FFF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Plus size={12} /> Subir chat
        </button>
      </div>

      {loading && <p style={{ color: '#52526A', fontSize: 13 }}>Cargando...</p>}
      {!loading && convs.length === 0 && <p style={{ color: '#52526A', fontSize: 13 }}>Sin chats subidos.</p>}

      {convs.map(c => {
        const isExp = expanded.has(c.id)
        return (
          <div key={c.id} style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#8B8BA0' }}>
                <span style={{ fontWeight: 600 }}>{c.author_name}</span>
                <span style={{ color: '#52526A', marginLeft: 10, fontFamily: 'monospace' }}>
                  {format(new Date(c.created_at), 'dd MMM yyyy, HH:mm')}
                </span>
              </div>
              <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                {isExp ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>
            <div style={{ fontSize: 13, color: '#F0F0F5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {isExp ? c.chat_content : (c.chat_content.length > 120 ? c.chat_content.slice(0, 120) + '…' : c.chat_content)}
            </div>
          </div>
        )
      })}

      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#F0F0F5' }}>Chat de venta — {prospectName}</h3>
              <button onClick={() => { setAddOpen(false); setChatContent(''); setError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}><X size={16} /></button>
            </div>
            <label style={{ fontSize: 12, color: '#52526A', display: 'block', marginBottom: 6 }}>Pegá la conversación completa con el cliente:</label>
            <textarea
              value={chatContent}
              onChange={e => setChatContent(e.target.value)}
              rows={14}
              placeholder="Conversación..."
              style={{ width: '100%', backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, padding: '10px 12px', color: '#F0F0F5', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {error && <p style={{ color: '#EF4444', fontSize: 12, margin: '8px 0 0' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setAddOpen(false); setChatContent(''); setError('') }} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving || !chatContent.trim()} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: saving || !chatContent.trim() ? '#2A2A3A' : '#6C63FF', color: '#FFF', cursor: saving || !chatContent.trim() ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {saving ? 'Guardando...' : 'Guardar chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
