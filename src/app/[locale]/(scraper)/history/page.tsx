'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { scraperApi, type Lead, type RunLog } from '@/lib/scraper-api';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import type { RunRecord } from '@/lib/types';

const ACTIVE = new Set(['pending', 'running', 'scoring', 'drafting']);

const LOG_COLORS: Record<string, string> = {
  info:    'var(--crm-text-secondary)',
  success: '#22C55E',
  warning: '#F59E0B',
  error:   '#EF4444',
};

const S: Record<string, React.CSSProperties> = {
  page:    { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 900 },
  row:     { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  logBox:  { backgroundColor: '#0D1117', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '10px 12px', maxHeight: 260, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7, marginBottom: 12 },
};

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runLeads, setRunLeads] = useState<Record<string, Lead[]>>({});
  const [leadsLoading, setLeadsLoading] = useState<Record<string, boolean>>({});
  const [runLogs, setRunLogs] = useState<Record<string, RunLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<Record<string, boolean>>({});
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [clearAllInput, setClearAllInput] = useState('');
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const logBoxRef = useRef<Record<string, HTMLDivElement | null>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = async () => {
    const r = await fetch('/api/runs').catch(() => null);
    if (!r?.ok) return;
    const data: RunRecord[] = await r.json();
    if (Array.isArray(data)) setRuns(data);
  };

  useEffect(() => {
    fetchRuns().finally(() => setLoading(false));
  }, []);

  const fetchLogs = async (runId: string, silent = false) => {
    if (!silent) setLogsLoading(p => ({ ...p, [runId]: true }));
    try {
      const logs = await scraperApi.get<RunLog[]>(`/runs/${runId}/logs`);
      setRunLogs(p => ({ ...p, [runId]: Array.isArray(logs) ? logs : [] }));
      // Auto-scroll to bottom
      const el = logBoxRef.current[runId];
      if (el) el.scrollTop = el.scrollHeight;
    } catch { /* backend unavailable */ }
    finally { if (!silent) setLogsLoading(p => ({ ...p, [runId]: false })); }
  };

  // Poll logs + run status for active expanded run
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!expandedId) return;
    const run = runs.find(r => r.id === expandedId);
    if (!run || !ACTIVE.has(run.status)) return;

    pollRef.current = setInterval(async () => {
      await Promise.all([fetchLogs(expandedId, true), fetchRuns()]);
    }, 4000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, runs.find(r => r.id === expandedId)?.status]);

  const toggleExpand = async (runId: string) => {
    if (expandedId === runId) { setExpandedId(null); return; }
    setExpandedId(runId);

    // Fetch leads
    if (!runLeads[runId]) {
      setLeadsLoading(p => ({ ...p, [runId]: true }));
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('scraper_leads').select('*')
          .eq('run_id', runId).order('created_at', { ascending: false }).limit(200);
        setRunLeads(p => ({ ...p, [runId]: (data ?? []) as Lead[] }));
      } catch { /* supabase error */ }
      finally { setLeadsLoading(p => ({ ...p, [runId]: false })); }
    }

    // Fetch logs
    await fetchLogs(runId);
  };

  const handleCancelRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    setCancellingIds(prev => new Set(prev).add(runId));
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      const body = await res.json();
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
  };

  const handleClearAll = async () => {
    if (clearAllInput !== 'DELETE') return;
    try {
      const res = await fetch('/api/runs', { method: 'DELETE' });
      if (res.ok) { setRuns([]); setExpandedId(null); setRunLeads({}); setRunLogs({}); }
    } catch { /* ignore */ }
    finally { setClearAllConfirm(false); setClearAllInput(''); }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Run History</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>{runs.length} runs</span>
          {clearAllConfirm ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--crm-text-secondary)' }}>Type <b>DELETE</b>:</span>
              <input autoFocus value={clearAllInput} onChange={e => setClearAllInput(e.target.value)} placeholder="DELETE"
                style={{ width: 80, padding: '4px 8px', fontSize: 11, borderRadius: 6, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid #EF444430', color: 'var(--crm-text-primary)', outline: 'none' }} />
              <button onClick={handleClearAll} disabled={clearAllInput !== 'DELETE'}
                style={{ fontSize: 11, backgroundColor: '#EF4444', color: '#FFF', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', opacity: clearAllInput !== 'DELETE' ? 0.3 : 1 }}>
                Delete all
              </button>
              <button onClick={() => { setClearAllConfirm(false); setClearAllInput(''); }}
                style={{ fontSize: 11, color: 'var(--crm-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => runs.length > 0 && setClearAllConfirm(true)} disabled={runs.length === 0}
              style={{ fontSize: 11, color: 'var(--crm-text-muted)', border: '1px solid var(--crm-border)', padding: '5px 10px', borderRadius: 6, background: 'transparent', cursor: 'pointer', opacity: runs.length === 0 ? 0.3 : 1 }}>
              Clear History
            </button>
          )}
        </div>
      </div>

      {loading && <p style={{ color: 'var(--crm-text-muted)', textAlign: 'center', padding: 40 }}>Loading…</p>}
      {!loading && runs.length === 0 && <p style={{ color: 'var(--crm-text-muted)', textAlign: 'center', padding: 40 }}>No runs yet.</p>}

      {runs.map(run => {
        const isExpanded = expandedId === run.id;
        const leads = runLeads[run.id] ?? [];
        const leadsLoad = leadsLoading[run.id] ?? false;
        const logs = runLogs[run.id] ?? [];
        const logsLoad = logsLoading[run.id] ?? false;
        const isActive = ACTIVE.has(run.status);
        const isCancelling = cancellingIds.has(run.id);

        return (
          <div key={run.id} style={S.row}>
            {/* Row header */}
            <div onClick={() => toggleExpand(run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--crm-text-muted)', flexShrink: 0, width: 80 }}>
                {new Date(run.created_at).toLocaleDateString()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80 }}>
                {(run.markets?.length ? run.markets : [run.market]).join(' + ')}
              </span>
              <div style={{ flex: 1, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--crm-text-secondary)' }}>{run.total_leads_requested} leads req.</span>
                {run.combos?.length > 0 && (
                  <span style={{ color: 'var(--crm-text-muted)' }}>{run.combos.join(' · ')}</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={run.status as Parameters<typeof StatusBadge>[0]['status']} />
                {isActive && (
                  <button onClick={e => handleCancelRun(e, run.id)} disabled={isCancelling}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#EF4444', background: 'transparent', border: '1px solid #EF444440', borderRadius: 6, padding: '3px 8px', cursor: isCancelling ? 'default' : 'pointer', opacity: isCancelling ? 0.5 : 1, flexShrink: 0 }}>
                    <XCircle size={12} />{isCancelling ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
                {isExpanded ? <ChevronUp size={14} color="var(--crm-text-muted)" /> : <ChevronDown size={14} color="var(--crm-text-muted)" />}
              </div>
            </div>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--crm-border)', padding: 16 }}>

                {/* Run metadata */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 12, color: 'var(--crm-text-secondary)' }}>
                  {run.executor?.full_name && (
                    <span>Executed by: <span style={{ color: 'var(--crm-text-primary)', fontWeight: 500 }}>{run.executor.full_name}</span></span>
                  )}
                  {run.run_sdr_assignments && run.run_sdr_assignments.length > 0 && (
                    <span>
                      SDRs: {run.run_sdr_assignments.map(a => (
                        <span key={a.sdr_id} style={{ color: 'var(--crm-text-primary)', fontWeight: 500, marginLeft: 4 }}>
                          {a.user?.full_name ?? a.sdr_id}
                          {a.assigned_markets?.length ? ` (${a.assigned_markets.join(', ')})` : ''}
                          {a.leads_assigned > 0 ? `: ${a.leads_assigned}` : ''}
                          {a.sender_profile_id ? ' ✦' : ''}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                {/* Logs */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Logs</span>
                    {isActive && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--crm-accent)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--crm-accent)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        Live
                      </span>
                    )}
                    {logs.length > 0 && <span style={{ fontSize: 10, color: 'var(--crm-text-muted)', marginLeft: 'auto' }}>{logs.length} entries</span>}
                  </div>
                  <div style={S.logBox} ref={el => { logBoxRef.current[run.id] = el; }}>
                    {logsLoad && <span style={{ color: '#52526A' }}>Loading logs…</span>}
                    {!logsLoad && logs.length === 0 && (
                      <span style={{ color: '#52526A' }}>No logs yet{isActive ? ' — waiting for backend…' : '.'}</span>
                    )}
                    {logs.map((log, i) => (
                      <div key={log.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                        <span style={{ color: '#52526A', flexShrink: 0, fontSize: 10 }}>
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                        <span style={{ color: LOG_COLORS[log.level] ?? 'var(--crm-text-secondary)', flexShrink: 0, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 52 }}>
                          {log.level}
                        </span>
                        <span style={{ color: '#C9D1D9', wordBreak: 'break-word' }}>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Leads preview */}
                {leadsLoad ? (
                  <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 12 }}>Loading leads…</p>
                ) : leads.length > 0 ? (
                  <div style={{ border: '1px solid var(--crm-border)', borderRadius: 8, overflow: 'auto', marginBottom: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--crm-border)' }}>
                          {['Name', 'Company', 'Title', 'ICP', 'Temp'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {leads.slice(0, 15).map((lead, i) => (
                          <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid var(--crm-border)' : undefined }}>
                            <td style={{ padding: '6px 12px', color: 'var(--crm-text-primary)', fontWeight: 600 }}>{lead.full_name || '—'}</td>
                            <td style={{ padding: '6px 12px', color: 'var(--crm-text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                            <td style={{ padding: '6px 12px', color: 'var(--crm-text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                            <td style={{ padding: '6px 12px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                            <td style={{ padding: '6px 12px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {leads.length > 15 && <p style={{ padding: '6px 12px', fontSize: 11, color: 'var(--crm-text-muted)', textAlign: 'center', borderTop: '1px solid var(--crm-border)', margin: 0 }}>… and {leads.length - 15} more</p>}
                  </div>
                ) : null}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {run.status === 'completed' && (
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--crm-text-muted)' }}>
                      Leads auto-assigned to the run&apos;s SDRs — see their Kanban boards.
                    </span>
                  )}
                  <button onClick={() => setExpandedId(null)}
                    style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--crm-text-muted)', border: '1px solid var(--crm-border)', padding: '7px 14px', borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
