'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { Mail, Phone, Building2, Globe, RefreshCw, ExternalLink } from 'lucide-react'

/**
 * Inbox for the demo requests captured by the public landing page.
 *
 * Without this screen the landing form is a black hole: rows land in
 * `demo_requests` and the only way to read them is SQL. A capture form nobody
 * checks is worse than no form, because the prospect believes they were heard.
 */

type DemoRequest = {
  id: string
  full_name: string
  email: string
  company: string | null
  phone: string | null
  team_size: string | null
  message: string | null
  locale: string | null
  source_path: string | null
  status: string
  notes: string | null
  created_at: string
}

const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'discarded'] as const

const STATUS_COLOR: Record<string, string> = {
  new: '#6C63FF',
  contacted: '#3B82F6',
  qualified: '#F59E0B',
  converted: '#22C55E',
  discarded: '#8B8BA0',
}

const LOCALE_LABEL: Record<string, string> = {
  zh: '繁中', en: 'EN', es: 'ES', vi: 'VI',
}

export default function DemoRequestsPage() {
  const { colors, t } = useGlobalAdminTheme()
  const [requests, setRequests] = useState<DemoRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [saving, setSaving] = useState<string | null>(null)
  const [openNotes, setOpenNotes] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/global-admin/demo-requests')
      if (!res.ok) throw new Error('load failed')
      const json = await res.json()
      setRequests(json.requests ?? [])
      setError(null)
    } catch {
      setError(t('demoRequestsLoadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  async function patch(id: string, body: Record<string, unknown>) {
    setSaving(id)
    try {
      const res = await fetch('/api/global-admin/demo-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setRequests(prev => prev.map(r => (r.id === id ? json.request : r)))
    } catch {
      setError(t('demoRequestsSaveError'))
    } finally {
      setSaving(null)
    }
  }

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: requests.length }
    for (const s of STATUSES) out[s] = requests.filter(r => r.status === s).length
    return out
  }, [requests])

  const shown = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto', color: colors.textPrimary }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t('demoRequests')}</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 0' }}>
            {t('demoRequestsSubtitle')}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={load}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
            borderRadius: 8, border: `1px solid ${colors.border}`, cursor: 'pointer',
            background: colors.surface, color: colors.textSecondary, fontSize: 12.5, fontWeight: 600,
          }}
        >
          <RefreshCw size={13} /> {t('refresh')}
        </button>
      </div>

      {/* Status filter. Counts sit on the tabs so an unworked queue is visible
          without opening anything. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {(['all', ...STATUSES] as const).map(s => {
          const active = filter === s
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 13px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? colors.accent : colors.surface,
                color: active ? '#FFF' : colors.textSecondary,
              }}
            >
              {s === 'all' ? t('all') : t(`demoStatus_${s}`)}
              <span style={{ marginLeft: 6, opacity: .7 }}>{counts[s] ?? 0}</span>
            </button>
          )
        })}
      </div>

      {error && (
        <div style={{
          padding: '10px 13px', borderRadius: 8, marginBottom: 14, fontSize: 13,
          background: '#EF444415', border: '1px solid #EF444440', color: '#EF4444',
        }}>{error}</div>
      )}

      {loading ? (
        <p style={{ color: colors.textMuted, fontSize: 13 }}>{t('loading')}</p>
      ) : shown.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', borderRadius: 12,
          background: colors.surface, border: `1px solid ${colors.border}`,
        }}>
          <p style={{ margin: 0, fontSize: 14, color: colors.textMuted }}>
            {filter === 'all' ? t('demoRequestsEmpty') : t('demoRequestsEmptyFiltered')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(r => (
            <div key={r.id} style={{
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 12, padding: '14px 16px',
            }}>
              {/* Header row. The name/email side is allowed to shrink and
                  ellipsize so a long address can't push the status control
                  off screen — same pattern the CRM uses for name+action rows. */}
              <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{r.full_name}</span>
                    {r.locale && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: colors.surfaceRaised, color: colors.textMuted,
                      }}>{LOCALE_LABEL[r.locale] ?? r.locale}</span>
                    )}
                  </div>
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 5,
                    fontSize: 12.5, color: colors.textSecondary,
                  }}>
                    <a href={`mailto:${r.email}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: colors.accent, textDecoration: 'none' }}>
                      <Mail size={12} /> {r.email}
                    </a>
                    {r.company && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Building2 size={12} /> {r.company}
                      </span>
                    )}
                    {r.phone && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Phone size={12} /> {r.phone}
                      </span>
                    )}
                    {r.team_size && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Globe size={12} /> {r.team_size}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: colors.textMuted, whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <select
                    value={r.status}
                    disabled={saving === r.id}
                    onChange={e => patch(r.id, { status: e.target.value })}
                    style={{
                      padding: '5px 9px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: `${STATUS_COLOR[r.status]}20`,
                      color: STATUS_COLOR[r.status],
                      border: `1px solid ${STATUS_COLOR[r.status]}50`,
                    }}
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s} style={{ background: colors.surface, color: colors.textPrimary }}>
                        {t(`demoStatus_${s}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {r.message && (
                <p style={{
                  margin: '11px 0 0', padding: '9px 11px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
                  background: colors.surfaceRaised, color: colors.textSecondary, whiteSpace: 'pre-wrap',
                }}>{r.message}</p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    setOpenNotes(openNotes === r.id ? null : r.id)
                    setNoteDraft(r.notes ?? '')
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 12, fontWeight: 600, color: colors.accent,
                  }}
                >
                  {r.notes ? t('demoRequestsEditNote') : t('demoRequestsAddNote')}
                </button>
                {r.source_path && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: colors.textMuted }}>
                    <ExternalLink size={11} /> {r.source_path}
                  </span>
                )}
              </div>

              {r.notes && openNotes !== r.id && (
                <p style={{ margin: '8px 0 0', fontSize: 12.5, color: colors.textMuted, fontStyle: 'italic' }}>
                  {r.notes}
                </p>
              )}

              {openNotes === r.id && (
                <div style={{ marginTop: 9 }}>
                  <textarea
                    rows={3}
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
                      background: colors.bg, border: `1px solid ${colors.border}`,
                      color: colors.textPrimary, outline: 'none', resize: 'vertical',
                      fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                    <button
                      onClick={async () => { await patch(r.id, { notes: noteDraft }); setOpenNotes(null) }}
                      disabled={saving === r.id}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: colors.accent, color: '#FFF', fontSize: 12, fontWeight: 700,
                      }}
                    >{t('save')}</button>
                    <button
                      onClick={() => setOpenNotes(null)}
                      style={{
                        padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
                        background: 'transparent', border: `1px solid ${colors.border}`,
                        color: colors.textSecondary, fontSize: 12, fontWeight: 600,
                      }}
                    >{t('cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
