'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { Download } from 'lucide-react';
import type { RunRecord, Lead } from '@/lib/types';

const CSV_COLUMNS = ['full_name', 'linkedin_url', 'email', 'company', 'title', 'industry', 'company_size', 'icp_score', 'temperature', 'search_combo', 'created_at', 'market', 'custom1', 'custom2'] as const;

function leadsToCSV(leads: Lead[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = leads.map(lead =>
    CSV_COLUMNS.map(col => {
      const v = lead[col as keyof Lead];
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

function ExportContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get('run_id');

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(runIdParam ?? '');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/runs').then(r => r.json()).then((data: RunRecord[]) => {
      const completed = Array.isArray(data) ? data.filter(r => r.status === 'completed') : [];
      setRuns(completed);
      if (!runIdParam && completed.length > 0) setSelectedRunId(completed[0].id);
    }).catch(() => {});
  }, [runIdParam]);

  useEffect(() => {
    if (!selectedRunId) return;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from('scraper_leads')
      .select('*')
      .eq('run_id', selectedRunId)
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!error) setLeads((data ?? []) as Lead[]);
        setLoading(false);
      });
  }, [selectedRunId]);

  const handleDownload = () => {
    if (!leads.length) return;
    const csv = leadsToCSV(leads);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${selectedRunId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Exportar CSV</h1>

      {/* Config */}
      <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <label style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Seleccionar run</label>
        <select value={selectedRunId} onChange={e => setSelectedRunId(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 13, outline: 'none', marginBottom: 16 }}>
          <option value="">Seleccioná un run...</option>
          {runs.map(r => (
            <option key={r.id} value={r.id}>
              {(r.markets?.length ? r.markets : [r.market]).join(' + ')} — {new Date(r.created_at).toLocaleDateString()}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--crm-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>
            {loading ? 'Contando...' : (
              <span>
                <span style={{ color: 'var(--crm-text-primary)', fontWeight: 700, fontFamily: 'monospace' }}>{leads.length}</span> leads a exportar
              </span>
            )}
          </div>
          <button onClick={handleDownload} disabled={!selectedRunId || leads.length === 0 || loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: !selectedRunId || leads.length === 0 || loading ? 'var(--crm-border)' : 'var(--crm-accent)', color: '#FFF', padding: '9px 18px', borderRadius: 8, border: 'none', cursor: !selectedRunId || leads.length === 0 || loading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            <Download size={15} />Descargar CSV
          </button>
        </div>
      </div>

      {/* Preview */}
      {leads.length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Preview — {leads.length} leads</p>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, overflow: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--crm-border)' }}>
                  {['Nombre', 'Empresa', 'Título', 'ICP', 'Temp', 'Custom 1'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, color: 'var(--crm-text-muted)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.slice(0, 30).map((lead, i) => (
                  <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid var(--crm-border)' : undefined }}>
                    <td style={{ padding: '7px 14px', color: 'var(--crm-text-primary)' }}>{lead.full_name || '—'}</td>
                    <td style={{ padding: '7px 14px', color: 'var(--crm-text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                    <td style={{ padding: '7px 14px', color: 'var(--crm-text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                    <td style={{ padding: '7px 14px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                    <td style={{ padding: '7px 14px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                    <td style={{ padding: '7px 14px', color: 'var(--crm-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lead.custom1 || '—'}</td>
                  </tr>
                ))}
                {leads.length > 30 && <tr><td colSpan={6} style={{ padding: '6px 14px', textAlign: 'center', fontSize: 11, color: 'var(--crm-text-muted)', borderTop: '1px solid var(--crm-border)' }}>... y {leads.length - 30} más en el CSV</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Columns */}
      <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 10, padding: '16px 20px' }}>
        <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Columnas del CSV</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CSV_COLUMNS.map(col => (
            <span key={col} style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--crm-accent)', backgroundColor: '#6C63FF15', border: '1px solid #6C63FF20', padding: '2px 8px', borderRadius: 5 }}>{col}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ExportPage() {
  return (
    <Suspense fallback={<p style={{ color: 'var(--crm-text-muted)', padding: 40 }}>Cargando...</p>}>
      <ExportContent />
    </Suspense>
  );
}
