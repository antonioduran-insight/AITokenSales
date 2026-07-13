'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'
import { type Lead } from '@/lib/scraper-api'
import type { RunRecord } from '@/lib/types'
import { Check, X, RefreshCw, CheckCircle, Send, Copy } from 'lucide-react'

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam', 'Global']

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  confirmed: '#22C55E',
  rejected: '#EF4444',
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', color: 'var(--crm-text-primary)', height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  select: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', padding: '7px 10px', fontSize: 13 },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: 'var(--crm-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid var(--crm-border)', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 14px', borderBottom: '1px solid var(--crm-surface-raised)', fontSize: 13, verticalAlign: 'middle' as const },
}

function runLabel(run: RunRecord | undefined): string {
  if (!run) return '—'
  const markets = run.markets?.length ? run.markets : [run.market]
  return `${markets.join(' + ')} — ${new Date(run.created_at).toLocaleDateString()}`
}

export function BdLeadsContent() {
  const { user } = useUser()

  const [leads, setLeads] = useState<Lead[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [familyLabels, setFamilyLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [filterStatus, setFilterStatus] = useState<'pending' | 'confirmed' | 'rejected' | ''>('pending')
  const [filterMarket, setFilterMarket] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rowActionId, setRowActionId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const runsById = Object.fromEntries(runs.map(r => [r.id, r]))

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      let query = supabase
        .from('scraper_leads')
        .select('*')
        .eq('lead_type', 'bd_channel_contact')
        .order('created_at', { ascending: false })
        .limit(200)
      if (filterStatus) query = query.eq('verification_status', filterStatus)
      if (filterMarket) query = query.eq('market', filterMarket)
      const { data } = await query
      setLeads((data ?? []) as Lead[])
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterMarket])

  useEffect(() => {
    fetch('/api/runs').then(r => r.json()).then((data: RunRecord[]) => {
      setRuns(Array.isArray(data) ? data : [])
    }).catch(() => {})

    createClient().from('channel_family_types').select('code, label').then(({ data }) => {
      if (data) setFamilyLabels(Object.fromEntries(data.map((f: { code: string; label: string }) => [f.code, f.label])))
    })
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function isEligibleForMessaging(lead: Lead): boolean {
    return lead.verification_status === 'confirmed' && !lead.custom1
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleConfirm(lead: Lead) {
    setRowActionId(lead.id)
    try {
      const res = await fetch(`/api/bd-leads/${lead.id}/confirm`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? 'Failed to confirm'); return }
      showToast(data.bd_channel_created ? 'Confirmed — new channel created' : 'Confirmed — added to existing channel')
      fetchLeads()
    } finally {
      setRowActionId(null)
    }
  }

  async function handleReject(lead: Lead) {
    setRowActionId(lead.id)
    try {
      const res = await fetch(`/api/bd-leads/${lead.id}/reject`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? 'Failed to reject'); return }
      showToast('Lead rejected')
      fetchLeads()
    } finally {
      setRowActionId(null)
    }
  }

  async function handleGenerateMessages() {
    if (selected.size === 0) return
    setGenerating(true)
    try {
      const res = await fetch('/api/bd-leads/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: Array.from(selected) }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? 'Failed to generate messages'); return }
      const okCount = (data.results ?? []).filter((r: { ok: boolean }) => r.ok).length
      const failCount = (data.results ?? []).length - okCount
      showToast(failCount > 0
        ? `Message generation started for ${okCount} run(s), ${failCount} failed`
        : `Message generation started for ${okCount} run(s)`)
      setSelected(new Set())
    } finally {
      setGenerating(false)
    }
  }

  if (!user) {
    return <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>Loading…</div>
  }

  if (user.role !== 'admin') {
    return (
      <div style={{ padding: 40, color: 'var(--crm-text-muted)', textAlign: 'center' }}>
        <p style={{ fontSize: 15 }}>BD Leads review is only accessible to organization admins.</p>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>BD Leads</h1>

      {/* Filters */}
      <div style={S.header}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)} style={S.select}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filterMarket} onChange={e => setFilterMarket(e.target.value)} style={S.select}>
          <option value="">All markets</option>
          {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--crm-text-muted)' }}>{leads.length} candidates</span>
        <button onClick={fetchLeads} disabled={loading} style={{ padding: '7px 8px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--crm-border)', borderRadius: 10, backgroundColor: 'var(--crm-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--crm-surface)', zIndex: 1 }}>
            <tr>
              <th style={{ ...S.th, width: 32 }} />
              <th style={S.th}>Name</th>
              <th style={S.th}>Company</th>
              <th style={S.th}>Seed Company</th>
              <th style={S.th}>Channel Family</th>
              <th style={S.th}>Market</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Run</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: 'var(--crm-text-muted)', padding: 40 }}>Loading...</td></tr>}
            {!loading && leads.length === 0 && <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: 'var(--crm-text-muted)', padding: 40 }}>No BD candidates.</td></tr>}
            {!loading && leads.map(lead => {
              const eligible = isEligibleForMessaging(lead)
              const status = lead.verification_status ?? 'pending'
              return (
                <tr key={lead.id} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--crm-surface-raised)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ ...S.td, width: 32 }} onClick={e => e.stopPropagation()}>
                    {eligible ? (
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        style={{ accentColor: 'var(--crm-accent)', cursor: 'pointer' }}
                      />
                    ) : null}
                  </td>
                  <td style={S.td} onClick={() => setSelectedLead(lead)}>
                    <div style={{ fontWeight: 500 }}>{lead.full_name || '—'}</div>
                    {lead.title && <div style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 2 }}>{lead.title}</div>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--crm-text-secondary)' }} onClick={() => setSelectedLead(lead)}>{lead.company || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--crm-text-secondary)' }} onClick={() => setSelectedLead(lead)}>{lead.seed_company_name || '—'}</td>
                  <td style={{ ...S.td, color: 'var(--crm-text-secondary)', fontSize: 12 }} onClick={() => setSelectedLead(lead)}>
                    {lead.channel_family ? (familyLabels[lead.channel_family] ?? lead.channel_family) : '—'}
                  </td>
                  <td style={{ ...S.td, color: 'var(--crm-text-secondary)' }} onClick={() => setSelectedLead(lead)}>{lead.market || '—'}</td>
                  <td style={S.td} onClick={() => setSelectedLead(lead)}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      backgroundColor: (STATUS_COLORS[status] ?? '#8B8BA0') + '20',
                      color: STATUS_COLORS[status] ?? '#8B8BA0',
                      textTransform: 'capitalize',
                    }}>
                      {status}
                    </span>
                  </td>
                  <td style={{ ...S.td, color: 'var(--crm-text-muted)', fontSize: 11 }} onClick={() => setSelectedLead(lead)}>
                    {runLabel(runsById[lead.run_id])}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    {status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleConfirm(lead)}
                          disabled={rowActionId === lead.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: '1px solid #22C55E40', backgroundColor: '#22C55E15', color: '#22C55E', fontSize: 11, fontWeight: 600, cursor: rowActionId === lead.id ? 'default' : 'pointer' }}
                        >
                          <Check size={11} /> Confirm
                        </button>
                        <button
                          onClick={() => handleReject(lead)}
                          disabled={rowActionId === lead.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: '1px solid #EF444440', backgroundColor: '#EF444415', color: '#EF4444', fontSize: 11, fontWeight: 600, cursor: rowActionId === lead.id ? 'default' : 'pointer' }}
                        >
                          <X size={11} /> Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                        {status === 'confirmed' && lead.custom1 ? 'Messaged' : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selectedLead && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedLead(null) }}
        >
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 16, padding: 32, maxWidth: 720, width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>{selectedLead.full_name || '—'}</h2>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                  backgroundColor: (STATUS_COLORS[selectedLead.verification_status ?? 'pending'] ?? '#8B8BA0') + '20',
                  color: STATUS_COLORS[selectedLead.verification_status ?? 'pending'] ?? '#8B8BA0',
                }}>
                  {selectedLead.verification_status ?? 'pending'}
                </span>
              </div>
              <button onClick={() => setSelectedLead(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)', padding: 4 }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Profile</p>
                {[
                  { label: 'Company (returned)', value: selectedLead.company },
                  { label: 'Seed Company (searched)', value: selectedLead.seed_company_name },
                  { label: 'Channel Family', value: selectedLead.channel_family ? (familyLabels[selectedLead.channel_family] ?? selectedLead.channel_family) : undefined },
                  { label: 'Title', value: selectedLead.title },
                  { label: 'Industry', value: selectedLead.industry },
                  { label: 'Location', value: selectedLead.location },
                  { label: 'Email', value: selectedLead.email },
                  { label: 'Market', value: selectedLead.market },
                  { label: 'Run', value: runLabel(runsById[selectedLead.run_id]) },
                ].map(({ label, value }) => value ? (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 13, color: 'var(--crm-text-primary)', textAlign: 'right' }}>{value}</span>
                  </div>
                ) : null)}
                {selectedLead.linkedin_url && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--crm-text-muted)', flexShrink: 0 }}>LinkedIn</span>
                    <a href={selectedLead.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--crm-accent)', textDecoration: 'none' }}>View profile →</a>
                  </div>
                )}
              </div>
              <div>
                <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Outreach Messages</p>
                {selectedLead.custom1 || selectedLead.custom2 ? (
                  [
                    { label: 'Connection Request', value: selectedLead.custom1 },
                    { label: 'Value Message', value: selectedLead.custom2 },
                  ].map(({ label, value }) => value ? (
                    <div key={label} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--crm-text-secondary)', fontWeight: 600 }}>{label}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(value)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--crm-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <Copy size={11} /> Copy
                        </button>
                      </div>
                      <div style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--crm-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{value}</div>
                    </div>
                  ) : null)
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
                    {selectedLead.verification_status === 'confirmed' ? 'Not generated yet.' : 'Messages are generated after confirmation.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 24, zIndex: 60,
          backgroundColor: '#1A3A2A', border: '1px solid #22C55E40',
          borderRadius: 8, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: '#22C55E', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <CheckCircle size={14} />
          {toast}
        </div>
      )}

      {/* Bulk action bar — Generate Messages */}
      {selected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
          backgroundColor: '#0D0D14', borderTop: '1px solid var(--crm-border)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {selected.size} candidate{selected.size > 1 ? 's' : ''} selected
          </span>
          <div style={{ width: 1, height: 20, backgroundColor: 'var(--crm-border)' }} />
          <button
            onClick={handleGenerateMessages}
            disabled={generating}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 5, border: '1px solid #6C63FF40', backgroundColor: '#6C63FF15', color: 'var(--crm-accent)', fontSize: 12, cursor: generating ? 'default' : 'pointer', fontWeight: 600 }}
          >
            <Send size={12} /> {generating ? 'Starting...' : `Generate Messages (${selected.size})`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 5, border: 'none', backgroundColor: 'transparent', color: 'var(--crm-text-muted)', cursor: 'pointer', fontSize: 12 }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default function BdLeadsPage() {
  return <BdLeadsContent />
}
