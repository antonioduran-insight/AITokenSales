'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { getCurrentOrganizationId } from '@/lib/utils/organization'
import { format } from 'date-fns'
import { Send } from 'lucide-react'
import type { Note } from '@/lib/types'

interface Props {
  prospectId: string
  prospectName: string
}

export function NotesLog({ prospectId, prospectName }: Props) {
  const t = useTranslations('prospect')
  const [notes, setNotes] = useState<Note[]>([])
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function fetchNotes() {
    const supabase = createClient()
    const { data } = await supabase
      .from('notes')
      .select('*, author:users!author_id(id, full_name, email, role, area_id, is_active, created_at)')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: true })
    if (data) setNotes(data as unknown as Note[])
  }

  useEffect(() => { fetchNotes() }, [prospectId])

  async function handleAddNote() {
    if (!content.trim()) return
    setSaving(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const orgId = await getCurrentOrganizationId()
    const { error } = await supabase.from('notes').insert({
      prospect_id: prospectId,
      author_id: user.id,
      content: content.trim(),
      organization_id: orgId,
    })

    if (!error) {
      await logAuditEvent({
        event_type: 'note_added',
        prospect_id: prospectId,
        prospect_name: prospectName,
        metadata: { content: content.trim().slice(0, 80) },
      })
      setContent('')
      fetchNotes()
    }

    setSaving(false)
  }

  return (
    <div>
      {/* Notes list */}
      <div style={{ marginBottom: 16 }}>
        {notes.length === 0 ? (
          <p style={{ color: 'var(--crm-text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            {t('noNotes')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notes.map(note => (
              <div
                key={note.id}
                style={{
                  backgroundColor: 'var(--crm-surface-raised)',
                  border: '1px solid var(--crm-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)' }}>
                    {(note.author as { full_name: string })?.full_name ?? '—'}
                  </span>
                  <span
                    className="font-mono-data"
                    style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}
                  >
                    {format(new Date(note.created_at), 'dd MMM yyyy, HH:mm')}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--crm-text-primary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add note */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={t('noteContent')}
          rows={3}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote()
          }}
          style={{
            flex: 1,
            backgroundColor: 'var(--crm-surface-raised)',
            border: '1px solid var(--crm-border)',
            borderRadius: 8,
            padding: '8px 12px',
            color: 'var(--crm-text-primary)',
            fontSize: 13,
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleAddNote}
          disabled={saving || !content.trim()}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: content.trim() ? 'var(--crm-accent)' : 'var(--crm-border)',
            color: content.trim() ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)',
            cursor: content.trim() ? 'pointer' : 'not-allowed',
            alignSelf: 'flex-end',
            height: 38,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
