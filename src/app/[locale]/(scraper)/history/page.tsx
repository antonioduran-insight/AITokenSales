'use client';

import { useEffect, useState } from 'react';
import { scraperApi, SCRAPER_API_URL, type Run, type Lead } from '@/lib/scraper-api';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { ChevronDown, ChevronUp, Trash2, Download } from 'lucide-react';

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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchRuns = async () => {
    try { setRuns(await scraperApi.get<Run[]>('/run/?limit=50')); }
    catch { /* silent */ }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchRuns(); }, []);

  const toggleExpand = async (runId: string) => {
    if (expandedId === runId) { setExpandedId(null); return; }
    setExpandedId(runId);
    if (!runLeads[runId]) {
      setLeadsLoading(p => ({ ...p, [runId]: true }));
      try { const d = await scraperApi.get<Lead[]>(`/leads/?run_id=${runId}&limit=200`); setRunLeads(p => ({ ...p, [runId]: d })); }
      catch { /* backend unavailable */ }
      finally { setLeadsLoading(p => ({ ...p, [runId]: false })); }
    }
  };

  const handleDelete = async (runId: string) => {
    try { await scraperApi.delete(`/run/${runId}`); setRuns(prev => prev.filter(r => r.id !== runId)); if (expandedId === runId) setExpandedId(null); }
    catch { /* error */ }
    finally { setDeleteConfirmId(null); }
  };

  const handleClearAll = async () => {
    if (clearAllInput !== 'DELETE') return;
    try { await scraperApi.delete('/run/clear-all'); setRuns([]); setExpandedId(null); setRunLeads({}); }
    catch { /* error */ }
    finally { setClearAllConfirm(false); setClearAllInput(''); }
  };

  const handleDownloadCSV = async (runId: string) => {
    setDownloadingId(runId);
    try {
      const res = await fetch(`${SCRAPER_API_URL}/export/csv/${runId}`, { method: 'POST' });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `export_${runId.slice(0, 8)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* error */ }
    finally { setDownloadingId(null); }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Historial de Runs</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#52526A' }}>{runs.length} runs</span>
          {clearAllConfirm ? (
            <>
              <span style={{ fontSize: 11, color: '#8B8BA0' }}>Escribí <b>DELETE</b>:</span>
              <input autoFocus value={clearAllInput} onChange={e => setClearAllInput(e.target.value)} placeholder="DELETE"
                style={{ width: 80, padding: '4px 8px', fontSize: 11, borderRadius: 6, backgroundColor: '#1C1C27', border: '1px solid #EF444430', color: '#F0F0F5', outline: 'none' }} />
              <button onClick={handleClearAll} disabled={clearAllInput !== 'DELETE'}
                style={{ fontSize: 11, backgroundColor: '#EF4444', color: '#FFF', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', opacity: clearAllInput !== 'DELETE' ? 0.3 : 1 }}>
                Borrar todo
              </button>
              <button onClick={() => { setClearAllConfirm(false); setClearAllInput(''); }} style={{ fontSize: 11, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>Cancelar</button>
            </>
          ) : (
            <button onClick={() => runs.length > 0 && setClearAllConfirm(true)} disabled={runs.length === 0}
              style={{ fontSize: 11, color: '#52526A', border: '1px solid #2A2A3A', padding: '5px 10px', borderRadius: 6, background: 'transparent', cursor: 'pointer', opacity: runs.length === 0 ? 0.3 : 1 }}>
              Limpiar historial
            </button>
          )}
        </div>
      </div>

      {loading && <p style={{ color: '#52526A', textAlign: 'center', padding: 40 }}>Cargando...</p>}
      {!loading && runs.length === 0 && <p style={{ color: '#52526A', textAlign: 'center', padding: 40 }}>Sin runs todavía.</p>}

      {runs.map(run => {
        const isExpanded = expandedId === run.id;
        const leads = runLeads[run.id] ?? [];
        const leadsLoad = leadsLoading[run.id] ?? false;
        const isDel = deleteConfirmId === run.id;
        return (
          <div key={run.id} style={S.row}>
            <div onClick={() => !isDel && toggleExpand(run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#52526A', flexShrink: 0, width: 72 }}>
                {new Date(run.created_at).toLocaleDateString()}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80 }}>{run.market}</span>
              <span style={{ fontSize: 13, color: '#8B8BA0', fontFamily: 'monospace', display: 'none' }}>{run.total_leads} leads</span>
              <div style={{ flex: 1, display: 'flex', gap: 12, fontSize: 11 }}>
                {run.hot_count  > 0 && <span style={{ color: '#EF4444' }}>🔥 {run.hot_count}</span>}
                {run.warm_count > 0 && <span style={{ color: '#F59E0B' }}>🌡 {run.warm_count}</span>}
                {run.cold_count > 0 && <span style={{ color: '#60A5FA' }}>❄️ {run.cold_count}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={run.status} />
                {isDel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: '#8B8BA0' }}>¿Borrar?</span>
                    <button onClick={() => handleDelete(run.id)} style={{ fontSize: 11, backgroundColor: '#EF4444', color: '#FFF', padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer' }}>Sí</button>
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
                  {[
                    { label: 'Total', value: run.total_leads, color: '#F0F0F5' },
                    { label: 'HOT',   value: run.hot_count,   color: '#EF4444' },
                    { label: 'WARM',  value: run.warm_count,  color: '#F59E0B' },
                    { label: 'COLD',  value: run.cold_count,  color: '#60A5FA' },
                  ].map(s => (
                    <span key={s.label} style={{ padding: '3px 12px', borderRadius: 50, fontSize: 11, fontWeight: 600, fontFamily: 'monospace', backgroundColor: '#2A2A3A', color: s.color }}>
                      {s.label} {s.value}
                    </span>
                  ))}
                  <span style={{ padding: '3px 12px', borderRadius: 50, fontSize: 11, backgroundColor: '#2A2A3A', color: '#8B8BA0' }}>{run.combos.join(' · ')}</span>
                </div>

                {leadsLoad ? (
                  <p style={{ fontSize: 12, color: '#52526A' }}>Cargando leads...</p>
                ) : leads.length > 0 ? (
                  <div style={{ border: '1px solid #2A2A3A', borderRadius: 8, overflow: 'auto', marginBottom: 12 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2A2A3A' }}>
                          {['Nombre', 'Empresa', 'Título', 'ICP', 'Temp'].map(h => (
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
                    {leads.length > 15 && <p style={{ padding: '6px 12px', fontSize: 11, color: '#52526A', textAlign: 'center', borderTop: '1px solid #2A2A3A', margin: 0 }}>... y {leads.length - 15} más en el CSV</p>}
                  </div>
                ) : <p style={{ fontSize: 12, color: '#52526A' }}>Sin leads para este run.</p>}

                <div style={{ display: 'flex', gap: 8 }}>
                  {run.status === 'completed' && (
                    <button onClick={() => handleDownloadCSV(run.id)} disabled={downloadingId === run.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: '#6C63FF', color: '#FFF', padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', opacity: downloadingId === run.id ? 0.5 : 1 }}>
                      <Download size={12} />{downloadingId === run.id ? 'Descargando...' : 'Descargar CSV'}
                    </button>
                  )}
                  <button onClick={() => setExpandedId(null)} style={{ fontSize: 12, color: '#52526A', border: '1px solid #2A2A3A', padding: '7px 14px', borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>Cerrar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
