'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { type Lead } from '@/lib/scraper-api';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { ChevronDown, ChevronUp, DatabaseZap, CheckCircle2, XCircle } from 'lucide-react';
import type { Area, User, RunRecord } from '@/lib/types';

interface ImportState {
  area_id: string;
  assigned_to: string;
  loading: boolean;
  result: { imported: number; duplicates: number; no_name: number } | null;
  error: string | null;
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 900 },
  row:  { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
};

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runLeads, setRunLeads] = useState<Record<string, Lead[]>>({});
  const [leadsLoading, setLeadsLoading] = useState<Record<string, boolean>>({});
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [clearAllInput, setClearAllInput] = useState('');
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const [areas, setAreas] = useState<Area[]>([]);
  const [sdrs, setSdrs] = useState<User[]>([]);
  const [importOpen, setImportOpen] = useState<string | null>(null);
  const [importState, setImportState] = useState<Record<string, ImportState>>({});

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then((data: RunRecord[]) => setRuns(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

    const supabase = createClient();
    supabase.from('areas').select('*').then(({ data }) => { if (data) setAreas(data as Area[]) });
    supabase.from('users').select('*').eq('role', 'sdr').eq('is_active', true).then(({ data }) => { if (data) setSdrs(data as User[]) });
  }, []);

  const toggleExpand = async (runId: string) => {
    if (expandedId === runId) { setExpandedId(null); return; }
    setExpandedId(runId);
    if (!runLeads[runId]) {
      setLeadsLoading(p => ({ ...p, [runId]: true }));
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('scraper_leads')
          .select('*')
          .eq('run_id', runId)
          .order('created_at', { ascending: false })
          .limit(200);
        setRunLeads(p => ({ ...p, [runId]: (data ?? []) as Lead[] }));
      } catch { /* supabase error */ }
      finally { setLeadsLoading(p => ({ ...p, [runId]: false })); }
    }
  };

  const handleCancelRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    setCancellingIds(prev => new Set(prev).add(runId));
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      if (res.ok) {
        setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'cancelled' } : r));
      }
    } catch { /* ignore */ }
    finally {
      setCancellingIds(prev => { const s = new Set(prev); s.delete(runId); return s; });
    }
  };

  const handleClearAll = async () => {
    if (clearAllInput !== 'DELETE') return;
    // Runs are stored in Supabase — clearing via admin API would require a dedicated endpoint
    // For now, just close the confirm UI
    setClearAllConfirm(false);
    setClearAllInput('');
  };

  const openImport = (runId: string) => {
    setImportOpen(runId);
    if (!importState[runId]) {
      setImportState(p => ({
        ...p,
        [runId]: { area_id: areas[0]?.id ?? '', assigned_to: '', loading: false, result: null, error: null },
      }));
    }
  };

  const setImportField = (runId: string, field: keyof ImportState, value: unknown) => {
    setImportState(p => ({ ...p, [runId]: { ...p[runId], [field]: value } }));
  };

  const handleImportToCRM = async (runId: string) => {
    const s = importState[runId];
    if (!s?.area_id) return;
    setImportField(runId, 'loading', true);
    setImportField(runId, 'error', null);
    setImportField(runId, 'result', null);
    try {
      const res = await fetch('/api/scraper/to-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, area_id: s.area_id, assigned_to: s.assigned_to || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setImportField(runId, 'error', data.error ?? 'Import failed');
      else setImportField(runId, 'result', data);
    } catch (e) {
      setImportField(runId, 'error', String(e));
    } finally {
      setImportField(runId, 'loading', false);
    }
  };

  const SELECT: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 7, backgroundColor: 'var(--crm-surface-raised)',
    border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 12, outline: 'none',
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
              <button onClick={() => { setClearAllConfirm(false); setClearAllInput(''); }} style={{ fontSize: 11, color: 'var(--crm-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
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
        const imp = importState[run.id];
        const showImport = importOpen === run.id;
        const isActive = run.status === 'pending' || run.status === 'running';
        const isCancelling = cancellingIds.has(run.id);

        return (
          <div key={run.id} style={S.row}>
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
                  <button
                    onClick={e => handleCancelRun(e, run.id)}
                    disabled={isCancelling}
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
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: 'var(--crm-text-secondary)' }}>
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

                {leadsLoad ? (
                  <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>Loading leads…</p>
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
                ) : <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>No leads for this run.</p>}

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {run.status === 'completed' && !imp?.result && (
                      <button
                        onClick={() => showImport ? setImportOpen(null) : openImport(run.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: showImport ? 'var(--crm-border)' : 'var(--crm-accent)', color: '#FFF', padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer' }}>
                        <DatabaseZap size={13} />{showImport ? 'Cancel' : 'Import to CRM'}
                      </button>
                    )}
                    <button onClick={() => setExpandedId(null)} style={{ fontSize: 12, color: 'var(--crm-text-muted)', border: '1px solid var(--crm-border)', padding: '7px 14px', borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>Close</button>
                  </div>

                  {showImport && run.status === 'completed' && imp && !imp.result && (
                    <div style={{ backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', margin: 0, letterSpacing: '0.06em' }}>Import to CRM</p>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label style={{ fontSize: 11, color: 'var(--crm-text-secondary)', display: 'block', marginBottom: 4 }}>Area *</label>
                          <select value={imp.area_id} onChange={e => setImportField(run.id, 'area_id', e.target.value)} style={{ ...SELECT, width: '100%' }}>
                            <option value="">Select…</option>
                            {areas.filter(a => a.is_active).map(a => (
                              <option key={a.id} value={a.id}>{a.label_en}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label style={{ fontSize: 11, color: 'var(--crm-text-secondary)', display: 'block', marginBottom: 4 }}>Assign to SDR (optional)</label>
                          <select value={imp.assigned_to} onChange={e => setImportField(run.id, 'assigned_to', e.target.value)} style={{ ...SELECT, width: '100%' }}>
                            <option value="">Unassigned</option>
                            {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                          </select>
                        </div>
                      </div>
                      {imp.error && <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{imp.error}</p>}
                      <button
                        onClick={() => handleImportToCRM(run.id)}
                        disabled={!imp.area_id || imp.loading}
                        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: !imp.area_id || imp.loading ? 'var(--crm-border)' : 'var(--crm-accent)', color: '#FFF', padding: '7px 16px', borderRadius: 7, border: 'none', cursor: !imp.area_id || imp.loading ? 'default' : 'pointer', opacity: !imp.area_id ? 0.5 : 1 }}>
                        <DatabaseZap size={13} />{imp.loading ? 'Importing…' : `Import ${leads.length} leads`}
                      </button>
                    </div>
                  )}

                  {imp?.result && (
                    <div style={{ backgroundColor: '#14532D20', border: '1px solid #16A34A40', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CheckCircle2 size={16} color="#22C55E" />
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#22C55E', fontWeight: 600 }}>Imported: {imp.result.imported}</span>
                        <span style={{ color: 'var(--crm-text-muted)', marginLeft: 12 }}>Duplicates: {imp.result.duplicates}</span>
                        {imp.result.no_name > 0 && <span style={{ color: 'var(--crm-text-muted)', marginLeft: 12 }}>No name: {imp.result.no_name}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
