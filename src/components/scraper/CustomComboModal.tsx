'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import {
  COMPANY_HEADCOUNTS,
  MAX_COMBO_TITLE_KEYWORDS,
  SENIORITY_LEVELS,
  type ScraperComboMaster,
} from '@/lib/types'

/**
 * Create or edit a search strategy the organization owns.
 *
 * Before this existed, `scraper_combos_master` was a catalogue only Insight
 * Software could write to, and a customer whose buyers weren't already in it
 * had to wait for one of us to insert a row into a table every other customer
 * also reads. The three fields here are exactly what the Apify actor filters
 * on, so what an admin types is what the scraper searches for — and, since the
 * ICP scorer reads the run's own combos, what a lead is scored against.
 *
 * `seed` is how "Duplicate" works: a global combo can't be edited, but it can
 * be copied into the org and then changed freely. That is the cheap path for
 * the common case, which is not "write a strategy from scratch" but "yours is
 * close, ours needs three more titles".
 */
export interface CustomComboModalProps {
  /** The combo being edited, or a global one being copied. `null` = blank form. */
  seed: ScraperComboMaster | null
  /** True when `seed` is a copy source rather than the row being updated. */
  duplicating?: boolean
  onClose: () => void
  onSaved: (combo: ScraperComboMaster & { org_active?: boolean }) => void
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, backgroundColor: '#0A0A0FCC', zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
    borderRadius: 12, width: 560, maxWidth: '90vw', maxHeight: '88vh',
    overflowY: 'auto', boxSizing: 'border-box', padding: 24,
    color: 'var(--crm-text-primary)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, marginBottom: 18,
  },
  title: { fontSize: 15, fontWeight: 700, margin: 0 },
  closeBtn: {
    background: 'transparent', border: 'none', color: 'var(--crm-text-muted)',
    cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0,
  },
  label: {
    fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)',
    marginBottom: 6, display: 'block',
  },
  hint: { fontSize: 11, color: 'var(--crm-text-muted)', margin: '0 0 8px' },
  input: {
    width: '100%', backgroundColor: 'var(--crm-surface-raised)',
    border: '1px solid var(--crm-border)', borderRadius: 7,
    color: 'var(--crm-text-primary)', padding: '8px 12px', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  },
  field: { marginBottom: 18 },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  keywordChip: {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
    padding: '3px 8px', borderRadius: 5, backgroundColor: '#6C63FF20',
    color: 'var(--crm-accent)', border: '1px solid #6C63FF40',
  },
  chipX: {
    background: 'transparent', border: 'none', color: 'inherit',
    cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1,
  },
  error: {
    fontSize: 12, color: '#F87171', backgroundColor: '#F8717115',
    border: '1px solid #F8717140', borderRadius: 7, padding: '8px 12px',
    marginBottom: 14,
  },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 },
  btnPrimary: {
    backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none',
    borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
  },
  btnGhost: {
    backgroundColor: 'transparent', color: 'var(--crm-text-secondary)',
    border: '1px solid var(--crm-border)', borderRadius: 7, padding: '9px 18px',
    fontSize: 13, cursor: 'pointer',
  },
}

function toggleChipStyle(selected: boolean): React.CSSProperties {
  return {
    fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
    backgroundColor: selected ? '#6C63FF20' : 'var(--crm-surface-raised)',
    border: `1px solid ${selected ? '#6C63FF60' : 'var(--crm-border)'}`,
    color: selected ? 'var(--crm-accent)' : 'var(--crm-text-secondary)',
    transition: 'all .15s',
  }
}

export default function CustomComboModal({ seed, duplicating = false, onClose, onSaved }: CustomComboModalProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')

  // Editing writes back to this code; duplicating deliberately does not, so the
  // save becomes a create and the original global row is left untouched.
  const editingCode = seed && !duplicating ? seed.code : null

  const [name, setName] = useState(
    seed ? (duplicating ? t('comboCopySuffix', { name: seed.name }) : seed.name) : ''
  )
  const [description, setDescription] = useState(seed?.description ?? '')
  const [keywords, setKeywords] = useState<string[]>(seed?.title_keywords ?? [])
  const [keywordDraft, setKeywordDraft] = useState('')
  const [seniority, setSeniority] = useState<string[]>(seed?.seniority_levels ?? [])
  const [headcounts, setHeadcounts] = useState<string[]>(seed?.company_headcounts ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addKeyword(raw: string) {
    // Split on commas too: pasting a comma-separated list is the fastest way to
    // fill this in, and typing them one at a time is nobody's idea of a good
    // time when a combo carries a dozen title variants.
    const parts = raw.split(',').map(k => k.trim()).filter(Boolean)
    if (parts.length === 0) return
    setKeywords(prev => {
      const next = [...prev]
      for (const p of parts) {
        if (!next.some(k => k.toLowerCase() === p.toLowerCase())) next.push(p)
      }
      return next.slice(0, MAX_COMBO_TITLE_KEYWORDS)
    })
    setKeywordDraft('')
  }

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  async function save() {
    // Fold whatever is still sitting in the input into the list. Losing a title
    // because it was typed but not Entered is the kind of small betrayal that
    // makes people distrust a form.
    const pendingDraft = keywordDraft.trim()
    const finalKeywords = pendingDraft
      ? [...keywords, ...pendingDraft.split(',').map(k => k.trim()).filter(Boolean)
          .filter(p => !keywords.some(k => k.toLowerCase() === p.toLowerCase()))]
        .slice(0, MAX_COMBO_TITLE_KEYWORDS)
      : keywords

    if (!name.trim()) { setError(t('comboNameRequired')); return }
    if (finalKeywords.length === 0) { setError(t('comboTitlesRequired')); return }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        title_keywords: finalKeywords,
        seniority_levels: seniority,
        company_headcounts: headcounts,
        ...(editingCode ? { code: editingCode } : {}),
      }
      const res = await fetch('/api/scraper-combos', {
        method: editingCode ? 'PATCH' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? tc('error')); return }
      onSaved(body)
    } catch {
      setError(tc('error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <p style={S.title}>{editingCode ? t('editCombo') : t('newCombo')}</p>
          <button onClick={onClose} style={S.closeBtn} aria-label={tc('close')}>
            <X size={18} />
          </button>
        </div>

        {error && <div style={S.error}>{error}</div>}

        <div style={S.field}>
          <label style={S.label}>{t('comboName')}</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={S.input}
            maxLength={80}
            placeholder={t('comboNamePlaceholder')}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>{t('comboDescription')}</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={S.input}
            maxLength={300}
            placeholder={t('comboDescriptionPlaceholder')}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>
            {t('comboTitles')} ({keywords.length}/{MAX_COMBO_TITLE_KEYWORDS})
          </label>
          <p style={S.hint}>{t('comboTitlesHint')}</p>
          <input
            value={keywordDraft}
            onChange={e => setKeywordDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addKeyword(keywordDraft)
              } else if (e.key === 'Backspace' && !keywordDraft && keywords.length > 0) {
                setKeywords(prev => prev.slice(0, -1))
              }
            }}
            onBlur={() => addKeyword(keywordDraft)}
            style={{ ...S.input, marginBottom: keywords.length ? 10 : 0 }}
            placeholder={t('comboAddTitle')}
          />
          {keywords.length > 0 && (
            <div style={S.chipRow}>
              {keywords.map(k => (
                <span key={k} style={S.keywordChip}>
                  {k}
                  <button
                    onClick={() => setKeywords(prev => prev.filter(v => v !== k))}
                    style={S.chipX}
                    aria-label={tc('delete')}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={S.field}>
          <label style={S.label}>{t('comboSeniority')}</label>
          <p style={S.hint}>{t('comboOptionalFilter')}</p>
          <div style={S.chipRow}>
            {SENIORITY_LEVELS.map(level => (
              <button
                key={level}
                onClick={() => toggle(seniority, level, setSeniority)}
                style={toggleChipStyle(seniority.includes(level))}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div style={S.field}>
          <label style={S.label}>{t('comboHeadcounts')}</label>
          <p style={S.hint}>{t('comboOptionalFilter')}</p>
          <div style={S.chipRow}>
            {COMPANY_HEADCOUNTS.map(size => (
              <button
                key={size}
                onClick={() => toggle(headcounts, size, setHeadcounts)}
                style={toggleChipStyle(headcounts.includes(size))}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div style={S.actions}>
          <button onClick={onClose} style={S.btnGhost} disabled={saving}>{tc('cancel')}</button>
          <button
            onClick={save}
            style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
            disabled={saving}
          >
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
