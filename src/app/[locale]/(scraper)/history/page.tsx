'use client';

import { useEffect, useState } from 'react';
import { scraperApi, type Run, type Lead } from '@/lib/scraper-api';
import { createClient } from '@/lib/supabase/client';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { ChevronDown, ChevronUp, Trash2, DatabaseZap, CheckCircle2 } from 'lucide-react';
import type { Area, User } from '@/lib/types';

interface ImportState {
  area_id: string;
  assigned_to: string;
  loading: boolean;
  result: { imported: number; duplicates: number; no_name: number } | null;
  error: string | null;
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: '#F0F0F5', maxWidth: 900 },
  row: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
};

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runLeads, setRunLeads] = useState<Record<string, Lead[]>>({});
  const [leadsLoading, setLeadsLoading] = useState<Record<string, boolean>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [clearAllInput, setClearAllInput] = useState('');

  const [areas, setAreas] = useState<Area[]>([]);
  const [sdrs, setSdrs] = useState<User[]>([]);
  const [importOpen, setImportOpen] = useState<string | null>(null);
  const [importState, setImportState] = useState<Record<string, ImportState>>({});

  useEffect(() => {
    scraperApi.get<Run[]>('/run/?limit=50')
      .then(data => setRuns(data))
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
        const d = await scraperApi.get<Lead[]>(`/leads/?run_id=${runId}&limit=200`);
        setRunLeads(p => ({ ...p, [runId]: d }));
      } catch { /* backend unavailable */ }
      finally { setLeadsLoading(p => ({ ...p, [runId]: false })); }
    }
  };

  const handleDelete = async (runId: string) => {
    try {
      await scraperApi.delete(`/run/${runId}`);
      setRuns(prev => prev.filter(r => r.id !== runId));
      if (expandedId === runId) setExpandedId(null);
    } catch { /* error */ }
    finally { setDeleteConfirmId(null); }
  };

  const handleClearAll = async () => {
    if (clearAllInput !== 'DELETE') return;
    try {
      await scraperApi.delete('/run/clear-all');
      setRuns([]); setExpandedId(null); setRunLeads({});
    } catch { /* error */ }
    finally { setClearAllConfirm(false); setClearAllInput(''); }
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
      if (!res.ok) { setImportField(runId, 'error', data.error ?? 'Import failed'); }
      else { setImportField(runId, 'result', data); }
    } catch (e) {
      setImportField(runId, 'error', String(e));
    } finally {
      setImportField(runId, 'loading', false);
    }
  };

  const SELECT = {
    padding: '7px 10px', borderRadius: 7, backgroundColor: '#1C1C27',
    border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 12, outline: 'none',
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Run History</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#52526A' }}>{runs.length} runs</span>
          {clearAllConfirm ? (
            <>
              <span style={{ fontSize: 11, color: '#8B8BA0' }}>Type <b>DELETE</b>:</span>
              <input autoFocus value={clearAllInput} onChange={e => setClearAllInput(e.target.value)} placeholder="DELETE"
                style={{ width: 80, padding: '4px 8px', fontSize: 11, borderRadius: 6, backgroundColor: '#1C1C27', border: '1px solid #EF444430', color: '#F0F0F5', outline: 'none' }} />
              <button onClick={handleClearAll} disabled={clearAllInput !== 'DELETE'}
                style={{ fontSize: 11, backgroundColor: '#EF4444', color: '#FFF', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', opacity: clearAllInput !== 'DELETE' ? 0.3 : 1 }}>
                Delete all
              </button>
              <button onClick={() => { setClearAllConfirm(false); setClearAllInput(''); }} style={{ fontSize: 11, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => runs.length > 0 && setClearAllConfirm(true)} disabled={runs.length === 0}
              style={{ fontSize: 11, color: '#52526A', border: '1px solid #2A2A3A', padding: '5px 10px', borderRadius: 6, background: 'transparent', cursor: 'pointer', opacity: runs.length === 0 ? 0.3 : 1 }}>
              Clear History
            </button>
          )}
        </div>
      </div>

      {loading && <p style={{ color: '#52526A', textAlign: 'center', padding: 40 }}>Loading...</p>}
      {!loading && runs.length === 0 && <p style={{ color: '#52526A', textAlign: 'center', padding: 40 }}>No runs yet.</p>}

      {runs.map(run => {
        const isExpanded = expandedId === run.id;
        const leads = runLeads[run.id] ?? [];
        const leadsLoad = leadsLoading[run.id] ?? false;
        const isDel = deleteConfirmId === run.id;
        const imp = importState[run.id];
        const showImport = importOpen === run.id;

        return (
          <div key={run.id} style={S.row}>
            <div onClick={() => !isDel && toggleExpand(run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#52526A', flexShrink: 0, width: 72 }}>
                {new Date(run.created_at).toLocaleDateString()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80 }}>{run.market}</span>
              <div style={{ flex: 1, display: 'flex', gap: 12, fontSize: 11 }}>
                <span style={{ color: '#8B8BA0' }}>{run.total_leads} leads</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={run.status} />
                {isDel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: '#8B8BA0' }}>Delete?</span>
                    <button onClick={() => handleDelete(run.id)} style={{ fontSize: 11, backgroundColor: '#EF4444', color: '#FFF', padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer' }}>Yes</button>
                    <button onClick={() => setDeleteConfirmId(null)} style={{ fontSize: 11, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>No</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDeleteConfirmId(run.id); }} style={{ padding: 5, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: '#52526A' }}>
                    <Trash2 size={13} />
                  </button>
                )}
                {isExpanded ? <ChevronUp size={14} color="#52526A" /> : <ChevronDown size={14} color="#52526A" />}
              </div>
            </div>

            {isExpanded && (
              <div style={{ borderTop: '1px solid #2A2A3A', padding: 16 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={{ padding: '3px 12px', borderRadius: 50, fontSize: 11, fontWeight: 600, fontFamily: 'monospace', backgroundColor: '#2A2A3A', color: '#F0F0F5' }}>
                    {run.total_leads} leads
                  </span>
                  <span style={{ padding: '3px 12px', borderRadius: 50, fontSize: 11, backgroundColor: '#2A2A3A', color: '#8B8BA0' }}>{run.combos.join(' · ')}</span>
                </div>

                {leadsLoad ? (
                  <p style={{ fontSize: 12, color: '#52526A' }}>Loading leads...</p>
                ) : leads.length > 0 ? (
                  <div style={{ border: '1px solid #2A2A3A', borderRadius: 8, overflow: 'auto', marginBottom: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2A2A3A' }}>
                          {['Name', 'Company', 'Title', 'ICP', 'Temp'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: '#52526A', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {leads.slice(0, 15).map((lead, i) => (
                          <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid #2A2A3A' : undefined }}>
                            <td style={{ padding: '6px 12px', color: '#F0F0F5', fontWeight: 600 }}>{lead.full_name || '—'}</td>
                            <td style={{ padding: '6px 12px', color: '#8B8BA0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                            <td style={{ padding: '6px 12px', color: '#8B8BA0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                            <td style={{ padding: '6px 12px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                            <td style={{ padding: '6px 12px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {leads.length > 15 && <p style={{ padding: '6px 12px', fontSize: 11, color: '#52526A', textAlign: 'center', borderTop: '1px solid #2A2A3A', margin: 0 }}>... and {leads.length - 15} more</p>}
                  </div>
                ) : <p style={{ fontSize: 12, color: '#52526A' }}>No leads for this run.</p>}

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {run.status === 'completed' && !imp?.result && (
                      <button
                        onClick={() => showImport ? setImportOpen(null) : openImport(run.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: showImport ? '#2A2A3A' : '#6C63FF', color: '#FFF', padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer' }}>
                        <DatabaseZap size={13} />{showImport ? 'Cancel' : 'Import to CRM'}
                      </button>
                    )}
                    <button onClick={() => setExpandedId(null)} style={{ fontSize: 12, color: '#52526A', border: '1px solid #2A2A3A', padding: '7px 14px', borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>Close</button>
                  </div>

                  {/* Import form */}
                  {showImport && run.status === 'completed' && imp && !imp.result && (
                    <div style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', margin: 0, letterSpacing: '0.06em' }}>Import to CRM</p>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label style={{ fontSize: 11, color: '#8B8BA0', display: 'block', marginBottom: 4 }}>Area *</label>
                          <select value={imp.area_id} onChange={e => setImportField(run.id, 'area_id', e.target.value)} style={{ ...SELECT, width: '100%' }}>
                            <option value="">Select...</option>
                            {areas.filter(a => a.is_active).map(a => (
                              <option key={a.id} value={a.id}>{a.label_en}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <label style={{ fontSize: 11, color: '#8B8BA0', display: 'block', marginBottom: 4 }}>Assign to SDR (optional)</label>
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
                        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: !imp.area_id || imp.loading ? '#2A2A3A' : '#6C63FF', color: '#FFF', padding: '7px 16px', borderRadius: 7, border: 'none', cursor: !imp.area_id || imp.loading ? 'default' : 'pointer', opacity: !imp.area_id ? 0.5 : 1 }}>
                        <DatabaseZap size={13} />{imp.loading ? 'Importing...' : `Import ${leads.length} leads`}
                      </button>
                    </div>
                  )}

                  {/* Import result */}
                  {imp?.result && (
                    <div style={{ backgroundColor: '#14532D20', border: '1px solid #16A34A40', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CheckCircle2 size={16} color="#22C55E" />
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#22C55E', fontWeight: 600 }}>Imported: {imp.result.imported}</span>
                        <span style={{ color: '#52526A', marginLeft: 12 }}>Duplicates: {imp.result.duplicates}</span>
                        {imp.result.no_name > 0 && <span style={{ color: '#52526A', marginLeft: 12 }}>No name: {imp.result.no_name}</span>}
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
