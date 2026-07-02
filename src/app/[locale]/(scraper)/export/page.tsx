'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { scraperApi, SCRAPER_API_URL, type Run, type Lead } from '@/lib/scraper-api';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { Download } from 'lucide-react';

function ExportContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get('run_id');

  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(runIdParam ?? '');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    scraperApi.get<Run[]>('/run/?limit=50').then(data => {
      const completed = data.filter(r => r.status === 'completed');
      setRuns(completed);
      if (!runIdParam && completed.length > 0) setSelectedRunId(completed[0].id);
    }).catch(() => {});
  }, [runIdParam]);

  useEffect(() => {
    if (!selectedRunId) return;
    setLoading(true);
    scraperApi.get<Lead[]>(`/leads/?run_id=${selectedRunId}&limit=200`).then(setLeads).catch(() => {}).finally(() => setLoading(false));
  }, [selectedRunId]);

  const handleDownload = async () => {
    if (!selectedRunId) return;
    setDownloading(true);
    try {
      const res = await fetch(`${SCRAPER_API_URL}/export/csv/${selectedRunId}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `export_${selectedRunId.slice(0, 8)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('Export error:', e); }
    finally { setDownloading(false); }
  };

  const selectedRun = runs.find(r => r.id === selectedRunId);

  return (
    <div style={{ padding: '24px', color: '#F0F0F5', maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Exportar CSV</h1>

      {/* Config */}
      <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <label style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Seleccionar run</label>
        <select value={selectedRunId} onChange={e => setSelectedRunId(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 13, outline: 'none', marginBottom: 16 }}>
          <option value="">Select a run...</option>
          {runs.map(r => (
            <option key={r.id} value={r.id}>{r.market} — {new Date(r.created_at).toLocaleDateString()} · {r.total_leads} leads</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #2A2A3A', paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: '#8B8BA0' }}>
            {loading ? 'Contando...' : (
              <span>
                <span style={{ color: '#F0F0F5', fontWeight: 700, fontFamily: 'monospace' }}>{leads.length}</span> leads a exportar
                {selectedRun && <span style={{ marginLeft: 10, fontSize: 12 }}>· 🔥 {selectedRun.hot_count} / 🌡 {selectedRun.warm_count} / ❄️ {selectedRun.cold_count}</span>}
              </span>
            )}
          </div>
          <button onClick={handleDownload} disabled={!selectedRunId || leads.length === 0 || downloading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: !selectedRunId || leads.length === 0 || downloading ? '#2A2A3A' : '#6C63FF', color: '#FFF', padding: '9px 18px', borderRadius: 8, border: 'none', cursor: !selectedRunId || leads.length === 0 || downloading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            <Download size={15} />{downloading ? 'Descargando...' : 'Descargar CSV'}
          </button>
        </div>
      </div>

      {/* Preview */}
      {leads.length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Preview — {leads.length} leads</p>
          <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2A2A3A' }}>
                  {['Name', 'Company', 'Title', 'ICP', 'Temp', 'Custom 1'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, color: '#52526A', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.slice(0, 30).map((lead, i) => (
                  <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid #2A2A3A' : undefined }}>
                    <td style={{ padding: '7px 14px', color: '#F0F0F5' }}>{lead.full_name || '—'}</td>
                    <td style={{ padding: '7px 14px', color: '#8B8BA0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                    <td style={{ padding: '7px 14px', color: '#8B8BA0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                    <td style={{ padding: '7px 14px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                    <td style={{ padding: '7px 14px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                    <td style={{ padding: '7px 14px', color: '#52526A', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lead.custom1 || '—'}</td>
                  </tr>
                ))}
                {leads.length > 30 && <tr><td colSpan={6} style={{ padding: '6px 14px', textAlign: 'center', fontSize: 11, color: '#52526A', borderTop: '1px solid #2A2A3A' }}>... and {leads.length - 30} more in the CSV</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Columns */}
      <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Columnas del CSV</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['name', 'linkedin_url', 'email', 'company', 'title', 'industry', 'company_size', 'icp_score', 'lead_temperature', 'search_combo', 'scrape_date', 'market', 'custom1', 'custom2'].map(col => (
            <span key={col} style={{ fontFamily: 'monospace', fontSize: 11, color: '#6C63FF', backgroundColor: '#6C63FF15', border: '1px solid #6C63FF20', padding: '2px 8px', borderRadius: 5 }}>{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ExportPage() {
  return (
    <Suspense fallback={<p style={{ color: '#52526A', padding: 40 }}>Loading...</p>}>
      <ExportContent />
    </Suspense>
  );
}
