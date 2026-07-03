'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { useUser } from '@/contexts/UserContext'
import { useOrgId } from '@/lib/hooks/useOrgId'
import { format } from 'date-fns'
import { Trophy, Search, X, RefreshCw, MessageSquare, AlertTriangle, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConversationsLog } from '@/components/conversations/ConversationsLog'
import type { Area, User } from '@/lib/types'

interface ClosedProspect {
  id: string
  name: string
  company: string | null
  assigned_to: string | null
  created_at: string
  area?: { label_en: string }
  assigned_user?: { id: string; full_name: string }
  chatCount: number
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: '#F0F0F5', height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const },
  input: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px 7px 32px', fontSize: 13, width: 220, outline: 'none' },
  select: { backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 6, color: '#F0F0F5', padding: '7px 10px', fontSize: 13 },
  textarea: { width: '100%', backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 6, padding: '8px 10px', color: '#F0F0F5', fontSize: 13, resize: 'vertical' as const, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' as const },
  label: { fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', display: 'block', marginBottom: 6 },
}

const CLOSED_SELECT = 'id, name, company, assigned_to, created_at, area:areas(label_en), assigned_user:users!assigned_to(id, full_name)'

export function ConvertidosPage() {
  const t = useTranslations('convertidos')
  const tc = useTranslations('common')
  const { user } = useUser()
  const { isImpersonating, impersonateOrgId, isAdmin } = useOrgId()

  const [prospects, setProspects] = useState<ClosedProspect[]>([])
  const [loading, setLoading] = useState(true)
  const [sdrs, setSdrs] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [filterSdr, setFilterSdr] = useState('')

  // View modal state
  const [viewTarget, setViewTarget] = useState<ClosedProspect | null>(null)

  // Upload modal state
  const [uploadTarget, setUploadTarget] = useState<ClosedProspect | null>(null)
  const [reason, setReason] = useState('')
  const [chatContent, setChatContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isAdmin) {
      createClient().from('users').select('*').eq('role', 'sdr').eq('is_active', true).then(({ data }) => {
        if (data) setSdrs(data as User[])
      })
    }
  }, [isAdmin])

  const fetchProspects = useCallback(async () => {
    if (!user && !isImpersonating) return
    setLoading(true)
    try {
      let rawData: ClosedProspect[] = []

      if (isImpersonating && impersonateOrgId) {
        const params = new URLSearchParams({
          impersonate_org_id: impersonateOrgId,
          select: CLOSED_SELECT,
          status: 'closed',
          limit: '1000',
        })
        const res = await fetch(`/api/crm/prospects?${params}`)
        const json = await res.json()
        rawData = (json.data ?? []) as ClosedProspect[]
        if (filterSdr) rawData = rawData.filter(p => p.assigned_to === filterSdr)
      } else {
        const supabase = createClient()
        let query = supabase
          .from('prospects')
          .select(CLOSED_SELECT)
          .eq('outreach_status', 'closed')
          .order('created_at', { ascending: false })

        if (!isAdmin && user) query = query.eq('assigned_to', user.id)
        else if (filterSdr) query = query.eq('assigned_to', filterSdr)

        const { data } = await query
        rawData = (data ?? []) as unknown as ClosedProspect[]
      }

      // Fetch conversation counts via service-role API (bypasses RLS)
      const ids = rawData.map(p => p.id)
      let countMap: Record<string, number> = {}
      if (ids.length > 0) {
        const res = await fetch(`/api/conversations/counts?ids=${ids.join(',')}`)
        if (res.ok) countMap = await res.json()
      }

      let results = rawData.map(p => ({ ...p, chatCount: countMap[p.id] ?? 0 }))

      if (search.trim()) {
        const q = search.toLowerCase()
        results = results.filter(p => p.name.toLowerCase().includes(q) || (p.company ?? '').toLowerCase().includes(q))
      }

      setProspects(results)
    } finally {
      setLoading(false)
    }
  }, [user, isAdmin, isImpersonating, impersonateOrgId, filterSdr, search])

  useEffect(() => { fetchProspects() }, [fetchProspects])

  const isFirstUpload = uploadTarget ? uploadTarget.chatCount === 0 : true
  const canSave = isFirstUpload
    ? chatContent.trim().length > 0
    : reason.trim().length > 0 && chatContent.trim().length > 0

  async function handleSave() {
    if (!uploadTarget || !canSave) return
    setSaving(true)

    const finalReason = isFirstUpload ? t('firstChatHint') : reason.trim()

    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prospect_id: uploadTarget.id,
        chat_content: chatContent,
        reason: finalReason,
      }),
    })

    if (res.ok) {
      await logAuditEvent({
        event_type: 'conversation_added',
        prospect_id: uploadTarget.id,
        prospect_name: uploadTarget.name,
        metadata: { reason: finalReason, source: 'convertidos' },
      })
      setReason('')
      setChatContent('')
      setUploadTarget(null)
      fetchProspects()
    }
    setSaving(false)
  }

  const withoutChat = prospects.filter(p => p.chatCount === 0).length
  const withChat = prospects.filter(p => p.chatCount > 0).length

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Trophy size={20} color="#F59E0B" />
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t('title')}</h1>
          <span style={{ fontSize: 12, color: '#52526A' }}>{prospects.length} total</span>
        </div>
        <p style={{ fontSize: 13, color: '#F59E0B', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={13} />
          {t('subtitle')}
        </p>

        {/* Stats bar */}
        {prospects.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ padding: '6px 14px', borderRadius: 6, backgroundColor: '#EF444415', border: '1px solid #EF444430', fontSize: 12, color: '#EF4444', fontWeight: 600 }}>
              {withoutChat} {t('noChat')}
            </div>
            <div style={{ padding: '6px 14px', borderRadius: 6, backgroundColor: '#22C55E15', border: '1px solid #22C55E30', fontSize: 12, color: '#22C55E', fontWeight: 600 }}>
              {withChat} with {t('chats')}
            </div>
          </div>
        )}

        <div style={S.header}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#52526A' }} />
            <input
              style={S.input}
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {isAdmin && (
            <select value={filterSdr} onChange={e => setFilterSdr(e.target.value)} style={S.select}>
              <option value="">{t('allSdrs')}</option>
              {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}

          {(search || filterSdr) && (
            <button onClick={() => { setSearch(''); setFilterSdr('') }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', fontSize: 12 }}>
              <X size={12} /> {tc('clearFilters')}
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button onClick={fetchProspects} disabled={loading} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div style={{ textAlign: 'center', color: '#52526A', padding: 40 }}>{tc('loading')}</div>}
        {!loading && prospects.length === 0 && <div style={{ textAlign: 'center', color: '#52526A', padding: 40 }}>{t('noData')}</div>}

        {!loading && prospects.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
            {prospects.map(p => {
              const hasChat = p.chatCount > 0
              return (
                <div
                  key={p.id}
                  style={{
                    backgroundColor: '#13131A',
                    border: `1px solid ${hasChat ? '#2A2A3A' : '#EF444430'}`,
                    borderRadius: 10,
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F0F5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      {p.company && (
                        <div style={{ fontSize: 12, color: '#52526A', marginTop: 2 }}>{p.company}</div>
                      )}
                    </div>

                    {/* Chat badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: hasChat ? '#22C55E15' : '#EF444415', color: hasChat ? '#22C55E' : '#EF4444', border: `1px solid ${hasChat ? '#22C55E30' : '#EF444430'}`, flexShrink: 0 }}>
                      <MessageSquare size={11} />
                      {hasChat ? `${p.chatCount} ${t('chats')}` : t('noChat')}
                    </div>
                  </div>

                  {/* SDR + date */}
                  {isAdmin && p.assigned_user && (
                    <div style={{ fontSize: 12, color: '#52526A' }}>
                      SDR: <span style={{ color: '#8B8BA0' }}>{(p.assigned_user as { full_name: string }).full_name}</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(hasChat || isAdmin) && (
                      <button
                        onClick={() => setViewTarget(p)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: '1px solid #2A2A3A', backgroundColor: 'transparent', color: '#8B8BA0', flex: 1,
                        }}
                      >
                        <Eye size={13} />
                        {t('viewChats')}
                      </button>
                    )}
                    {!isImpersonating && (
                      <button
                        onClick={() => setUploadTarget(p)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: 'none',
                          backgroundColor: hasChat ? '#2A2A3A' : '#6C63FF',
                          color: hasChat ? '#8B8BA0' : '#FFF',
                          flex: hasChat ? 'none' : 1,
                        }}
                      >
                        <MessageSquare size={13} />
                        {hasChat ? t('addAnotherChat') : t('uploadChat')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* View chats modal */}
      {viewTarget && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) setViewTarget(null) }}
        >
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 600, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>{viewTarget.name}</h3>
                {viewTarget.company && <div style={{ fontSize: 13, color: '#52526A', marginTop: 3 }}>{viewTarget.company}</div>}
              </div>
              <button onClick={() => setViewTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                <X size={16} />
              </button>
            </div>
            <ConversationsLog prospectId={viewTarget.id} prospectName={viewTarget.name} isClosed={true} />
          </div>
        </div>
      )}

      {/* Upload modal */}
      {uploadTarget && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) { setUploadTarget(null); setReason(''); setChatContent('') } }}
        >
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: 24, width: 540, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F0F0F5', margin: 0 }}>
                  {isFirstUpload ? t('firstChatTitle') : t('anotherChatTitle')}
                </h3>
                <div style={{ fontSize: 13, color: '#52526A', marginTop: 4 }}>{uploadTarget.name}</div>
              </div>
              <button onClick={() => { setUploadTarget(null); setReason(''); setChatContent('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A', flexShrink: 0 }}>
                <X size={16} />
              </button>
            </div>

            {isFirstUpload ? (
              <div style={{ padding: '10px 12px', backgroundColor: '#6C63FF10', border: '1px solid #6C63FF30', borderRadius: 8, marginBottom: 16, fontSize: 13, color: '#8B8BA0' }}>
                {t('firstChatHint')}
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>{t('anotherChatHint')} <span style={{ color: '#EF4444' }}>*</span></label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value.slice(0, 200))}
                  placeholder="Contexto adicional..."
                  rows={2}
                  style={S.textarea}
                />
                <div style={{ fontSize: 11, color: reason.length > 180 ? '#F59E0B' : '#52526A', textAlign: 'right', marginTop: 4 }}>
                  {reason.length}/200
                </div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Chat completo <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea
                value={chatContent}
                onChange={e => setChatContent(e.target.value)}
                placeholder="Pegá aquí la conversación completa..."
                rows={12}
                style={S.textarea}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => { setUploadTarget(null); setReason(''); setChatContent('') }} style={{ flex: 1, backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                {tc('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !canSave}
                style={{ flex: 1, backgroundColor: '#6C63FF', color: '#FFF' }}
              >
                {saving ? tc('loading') : tc('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
