'use client';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { type Lead } from '@/lib/scraper-api';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { ChevronDown, ChevronUp, Download, Send, X, XCircle } from 'lucide-react';
import type { RunRecord, User, AreaName } from '@/lib/types';
import { inferAreaFromCountry } from '@/lib/utils/area-inference';

const ACTIVE = new Set(['pending', 'running', 'scraping', 'scoring', 'drafting']);

type SdrOption = User & { areaNames: string[] };

const CSV_COLUMNS = ['full_name', 'company', 'title', 'linkedin_url', 'location', 'icp_score', 'temperature', 'search_combo', 'market', 'custom1', 'custom2'] as const;

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 960, margin: '0 auto' },
  row:  { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  badge:{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-secondary)' },
};

function statusBadge(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    completed: { bg: '#22C55E20', color: '#22C55E' },
    failed:    { bg: '#EF444420', color: '#EF4444' },
    cancelled: { bg: '#52526A20', color: 'var(--crm-text-muted)' },
  };
  const active = ACTIVE.has(status);
  const c = active ? { bg: '#F59E0B20', color: '#F59E0B' } : (map[status] ?? { bg: 'var(--crm-border)', color: 'var(--crm-text-secondary)' });
  return { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, backgroundColor: c.bg, color: c.color };
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(runId: string, leads: Lead[]) {
  const header = CSV_COLUMNS.join(',');
  const body = leads.map(l => CSV_COLUMNS.map(c => csvEscape((l as unknown as Record<string, unknown>)[c])).join(',')).join('\n');
  const blob = new Blob([[header, body].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `run_${runId.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const runParam = searchParams.get('run');

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runLeads, setRunLeads] = useState<Record<string, Lead[]>>({});
  const [leadsLoading, setLeadsLoading] = useState<Record<string, boolean>>({});
  const [assignedBy, setAssignedBy] = useState<Record<string, Record<string, string>>>({}); // runId → linkedin_url → sdr name
  const [sdrs, setSdrs] = useState<SdrOption[]>([]);

  // "Send to another SDR" picker state
  const [sendOpenFor, setSendOpenFor] = useState<string | null>(null);
  const [sendSelected, setSendSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoExpanded = useRef(false);

  const fetchRuns = useCallback(async () => {
    const r = await fetch('/api/runs').catch(() => null);
    if (!r?.ok) return;
    const data: RunRecord[] = await r.json();
    if (Array.isArray(data)) setRuns(data);
  }, []);

  useEffect(() => { fetchRuns().finally(() => setLoading(false)); }, [fetchRuns]);

  // Load SDRs (with covered areas) for the "Send to another SDR" picker
  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from('users').select('*').eq('role', 'sdr').eq('is_active', true),
      supabase.from('areas').select('id, name'),
      supabase.from('user_areas').select('user_id, area_id'),
    ]).then(([usersRes, areasRes, uaRes]) => {
      const users = (usersRes.data ?? []) as User[];
      const areaName = new Map<string, string>(((areasRes.data ?? []) as Array<{ id: string; name: string }>).map(a => [a.id, a.name]));
      const areasByUser = new Map<string, string[]>();
      for (const ua of (uaRes.data ?? []) as Array<{ user_id: string; area_id: string }>) {
        const list = areasByUser.get(ua.user_id) ?? [];
        list.push(ua.area_id);
        areasByUser.set(ua.user_id, list);
      }
      setSdrs(users.map(u => {
        const names = new Set<string>();
        if (u.area_id && areaName.has(u.area_id)) names.add(areaName.get(u.area_id)!);
        for (const aid of areasByUser.get(u.id) ?? []) if (areaName.has(aid)) names.add(areaName.get(aid)!);
        return { ...u, areaNames: [...names] };
      }));
    });
  }, []);

  const loadRunDetail = useCallback(async (runId: string) => {
    if (runLeads[runId]) return;
    setLeadsLoading(p => ({ ...p, [runId]: true }));
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('scraper_leads').select('*')
        .eq('run_id', runId).order('icp_score', { ascending: false }).limit(500);
      const leads = (data ?? []) as Lead[];
      setRunLeads(p => ({ ...p, [runId]: leads }));

      // Resolve which SDR each lead landed on: join prospects by linkedin_url.
      const urls = leads.map(l => l.linkedin_url).filter(Boolean) as string[];
      if (urls.length > 0) {
        const { data: prospects } = await supabase
          .from('prospects')
          .select('linkedin_url, assigned_to, assigned_user:users!assigned_to(full_name)')
          .in('linkedin_url', urls);
        const map: Record<string, string> = {};
        for (const p of (prospects ?? []) as Array<{ linkedin_url: string | null; assigned_user?: { full_name?: string } | null }>) {
          if (p.linkedin_url && p.assigned_user?.full_name) map[p.linkedin_url] = p.assigned_user.full_name;
        }
        setAssignedBy(prev => ({ ...prev, [runId]: map }));
      }
    } catch { /* ignore */ }
    finally { setLeadsLoading(p => ({ ...p, [runId]: false })); }
  }, [runLeads]);

  const toggleExpand = useCallback((runId: string) => {
    setExpandedId(prev => (prev === runId ? null : runId));
    setSendOpenFor(null);
    setSendMsg(null);
    loadRunDetail(runId);
  }, [loadRunDetail]);

  // Auto-expand + scroll to ?run={id}
  useEffect(() => {
    if (autoExpanded.current || loading || !runParam) return;
    if (!runs.some(r => r.id === runParam)) return;
    autoExpanded.current = true;
    setExpandedId(runParam);
    loadRunDetail(runParam);
    setTimeout(() => rowRefs.current[runParam]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [runParam, runs, loading, loadRunDetail]);

  async function handleCancel(e: React.MouseEvent, runId: string) {
    e.stopPropagation();
    setCancellingIds(prev => new Set(prev).add(runId));
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'cancelled' } : r));
      } else {
        alert(`Cancel failed: ${body.error ?? res.status}`);
      }
    } catch (err) {
      alert(`Cancel error: ${String(err)}`);
    } finally {
      setCancellingIds(prev => { const s = new Set(prev); s.delete(runId); return s; });
    }
  }

  async function handleSend(runId: string, market: string) {
    if (!sendSelected || sending) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch(`/api/runs/${runId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual: true, sdr_id: sendSelected, market }),
      });
      const data = await res.json();
      if (!res.ok) { setSendMsg(data.error ?? 'Send failed'); return; }
      const name = sdrs.find(s => s.id === sendSelected)?.full_name ?? 'SDR';
      setSendMsg(`Moved ${data.assigned} leads to ${name}.`);
      setSendSelected(null);
      setSendOpenFor(null);
      // Refresh detail so re-sent SDRs drop out of the picker / assignee column.
      setRunLeads(prev => { const c = { ...prev }; delete c[runId]; return c; });
      loadRunDetail(runId);
    } catch (e) {
      setSendMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 20px' }}>Run History</h1>

      {loading && <p style={{ color: 'var(--crm-text-muted)', textAlign: 'center', padding: 40 }}>Loading…</p>}
      {!loading && runs.length === 0 && <p style={{ color: 'var(--crm-text-muted)', textAlign: 'center', padding: 40 }}>No runs yet.</p>}

      {runs.map(run => {
        const isExpanded = expandedId === run.id;
        const leads = runLeads[run.id] ?? [];
        const leadsLoad = leadsLoading[run.id] ?? false;
        const isActive = ACTIVE.has(run.status);
        const isFailed = run.status === 'failed' || run.status === 'cancelled';
        const markets = run.markets?.length ? run.markets : [run.market];
        const generated = (run.run_sdr_assignments ?? []).reduce((s, a) => s + (a.leads_assigned || 0), 0);
        const statusLabel = isActive ? 'Running' : run.status.charAt(0).toUpperCase() + run.status.slice(1);
        const runArea: AreaName | null = inferAreaFromCountry(run.market);
        // A run belongs to exactly ONE SDR.
        const assignment = (run.run_sdr_assignments ?? [])[0];
        const assignedSdrName = assignment?.user?.full_name
          ?? sdrs.find(s => s.id === assignment?.sdr_id)?.full_name
          ?? null;
        // Any SDR covering the run's market can receive the leads.
        const pickableSdrs = runArea ? sdrs.filter(s => s.areaNames.includes(runArea)) : sdrs;

        return (
          <div key={run.id} style={S.row} ref={el => { rowRefs.current[run.id] = el; }}>
            {/* Header */}
            <div onClick={() => toggleExpand(run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer' }}>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)' }}>
                  {new Date(run.created_at).toLocaleDateString()}
                </div>
                <div style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>
                  {new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {markets.map(m => <span key={m} style={{ ...S.badge, color: 'var(--crm-accent)', borderColor: '#6C63FF40' }}>{m}</span>)}
                {(run.combos ?? []).map(c => <span key={c} style={S.badge}>{c}</span>)}
              </div>
              <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)', fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
                {generated > 0 ? generated : run.total_leads_requested} leads
              </span>
              <span style={statusBadge(run.status)}>
                {isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor', animation: 'pulse 1.5s ease-in-out infinite' }} />}
                {statusLabel}
              </span>
              {isActive && (
                <button onClick={e => handleCancel(e, run.id)} disabled={cancellingIds.has(run.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 6, padding: '3px 9px', cursor: cancellingIds.has(run.id) ? 'default' : 'pointer', opacity: cancellingIds.has(run.id) ? 0.5 : 1, flexShrink: 0 }}>
                  <XCircle size={12} /> {cancellingIds.has(run.id) ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
              {isExpanded ? <ChevronUp size={16} color="var(--crm-text-muted)" /> : <ChevronDown size={16} color="var(--crm-text-muted)" />}
            </div>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--crm-border)', padding: 18 }}>
                {isFailed ? (
                  <p style={{ fontSize: 14, color: 'var(--crm-text-secondary)', margin: 0, textAlign: 'center', padding: '20px 0' }}>
                    This run failed. Contact support.
                  </p>
                ) : (
                  <>
                    {/* Toolbar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
                        {leads.length} leads
                        {assignedSdrName && (
                          <> · Assigned to: <strong style={{ color: 'var(--crm-text-primary)' }}>{assignedSdrName}</strong></>
                        )}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setSendOpenFor(sendOpenFor === run.id ? null : run.id); setSendSelected(null); setSendMsg(null); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--crm-text-secondary)', border: '1px solid var(--crm-border)', padding: '7px 14px', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>
                          <Send size={13} /> Send to another SDR
                        </button>
                        <button onClick={() => downloadCsv(run.id, leads)} disabled={leads.length === 0}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#FFF', backgroundColor: 'var(--crm-accent)', padding: '7px 14px', borderRadius: 8, border: 'none', cursor: leads.length === 0 ? 'default' : 'pointer', opacity: leads.length === 0 ? 0.4 : 1 }}>
                          <Download size={13} /> Download CSV
                        </button>
                      </div>
                    </div>

                    {/* Send-to picker */}
                    {sendOpenFor === run.id && (
                      <div style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--crm-text-primary)' }}>Move this run&apos;s leads to another SDR</span>
                          <button onClick={() => setSendOpenFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-muted)' }}><X size={15} /></button>
                        </div>
                        {pickableSdrs.length === 0 ? (
                          <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: 0 }}>No SDRs assigned to {run.market}.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                            {pickableSdrs.map(sdr => {
                              const sel = sendSelected === sdr.id;
                              return (
                                <label key={sdr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', backgroundColor: sel ? '#6C63FF10' : 'var(--crm-surface)', border: `1px solid ${sel ? '#6C63FF40' : 'var(--crm-border)'}` }}>
                                  <input type="radio" name={`send-${run.id}`} checked={sel} onChange={() => setSendSelected(sdr.id)} style={{ accentColor: 'var(--crm-accent)' }} />
                                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{sdr.full_name}</span>
                                  <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>{sdr.areaNames.join(', ')}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <button onClick={() => handleSend(run.id, run.market)} disabled={!sendSelected || sending}
                            style={{ fontSize: 12, fontWeight: 700, color: '#FFF', backgroundColor: !sendSelected || sending ? 'var(--crm-border)' : 'var(--crm-accent)', padding: '8px 18px', borderRadius: 8, border: 'none', cursor: !sendSelected || sending ? 'default' : 'pointer' }}>
                            {sending ? 'Moving…' : 'Move leads'}
                          </button>
                          {sendMsg && <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{sendMsg}</span>}
                        </div>
                      </div>
                    )}
                    {sendMsg && sendOpenFor !== run.id && (
                      <p style={{ fontSize: 12, color: '#22C55E', margin: '0 0 12px' }}>{sendMsg}</p>
                    )}

                    {/* Leads table */}
                    {leadsLoad ? (
                      <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>Loading leads…</p>
                    ) : leads.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>No leads for this run.</p>
                    ) : (
                      <div style={{ border: '1px solid var(--crm-border)', borderRadius: 8, overflow: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--crm-border)' }}>
                              {['Name', 'Company', 'Title', 'ICP', 'Temp', 'Assigned to'].map(h => (
                                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {leads.map((lead, i) => (
                              <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid var(--crm-border)' : undefined }}>
                                <td style={{ padding: '7px 12px', color: 'var(--crm-text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{lead.full_name || '—'}</td>
                                <td style={{ padding: '7px 12px', color: 'var(--crm-text-secondary)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                                <td style={{ padding: '7px 12px', color: 'var(--crm-text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                                <td style={{ padding: '7px 12px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                                <td style={{ padding: '7px 12px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                                <td style={{ padding: '7px 12px', color: 'var(--crm-text-secondary)', whiteSpace: 'nowrap' }}>
                                  {(lead.linkedin_url && assignedBy[run.id]?.[lead.linkedin_url]) || <span style={{ color: 'var(--crm-text-muted)' }}>—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--crm-text-muted)', padding: 40 }}>Loading…</p>}>
      <HistoryContent />
    </Suspense>
  );
}
