'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

export function TagInput({ value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState('')

  function commit() {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }

  function remove(tag: string) {
    onChange(value.filter(t => t !== tag))
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, padding: '7px 8px',
      backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
      borderRadius: 7, minHeight: 38, boxSizing: 'border-box' as const,
    }}>
      {value.map(tag => (
        <span key={tag} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)',
          borderRadius: 4, padding: '2px 6px 2px 8px', fontSize: 12,
        }}>
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', display: 'flex', padding: 0 }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && !draft && value.length > 0) remove(value[value.length - 1])
        }}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : undefined}
        style={{ flex: 1, minWidth: 100, background: 'none', border: 'none', outline: 'none', color: 'var(--crm-text-primary)', fontSize: 13 }}
      />
    </div>
  )
}
