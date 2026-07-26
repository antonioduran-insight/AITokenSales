'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const S: Record<string, React.CSSProperties> = {
  textarea: {
    width: '100%', backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
    borderRadius: 6, padding: '8px 10px', color: 'var(--crm-text-primary)', fontSize: 13,
    resize: 'vertical' as const, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
    boxSizing: 'border-box' as const,
  },
  label: {
    fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', display: 'block', marginBottom: 6,
  },
}

interface Props {
  open: boolean
  prospectName: string
  saving?: boolean
  /** Uploads the chat, then commits the move to Closed. */
  onSave: (chatContent: string) => void
  /** Commits the move to Closed without a chat — flags it as missing. */
  onSkip: () => void
  /** Aborts the move entirely — status stays whatever it was. */
  onCancel: () => void
}

/**
 * Mandatory gate shown the instant a lead is moved to 'closed' (from Kanban
 * drag-and-drop or the Leads/Kanban drawer's status dropdown). The deal is
 * not actually moved to Closed until one of the two actions here resolves —
 * dismissing (backdrop/X) aborts the move so nothing is left half-done.
 */
export function CloseDealModal({ open, prospectName, saving = false, onSave, onSkip, onCancel }: Props) {
  const t = useTranslations('convertidos')
  const [chatContent, setChatContent] = useState('')

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: 540, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--crm-text-primary)', margin: 0 }}>
              {t('modalTitle')}
            </h3>
            <div style={{ fontSize: 13, color: 'var(--crm-text-muted)', marginTop: 4 }}>{prospectName}</div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--crm-text-secondary)', margin: '0 0 16px' }}>{t('modalHint')}</p>

        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>{t('firstChatTitle')}</label>
          <textarea
            value={chatContent}
            onChange={e => setChatContent(e.target.value)}
            placeholder={t('firstChatHint')}
            rows={12}
            style={S.textarea}
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            onClick={onSkip}
            disabled={saving}
            style={{ flex: 1, backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}
          >
            {t('skipForNow')}
          </Button>
          <Button
            onClick={() => onSave(chatContent)}
            disabled={saving || !chatContent.trim()}
            style={{ flex: 1, backgroundColor: 'var(--crm-accent)', color: '#FFF' }}
          >
            {t('confirmClose')}
          </Button>
        </div>
      </div>
    </div>
  )
}
