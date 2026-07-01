'use client';

import { useState, useEffect, useRef } from 'react';
import { Link } from '@/i18n/navigation';
import { scraperApi, type Run, type RunLog, type RunStatus } from '@/lib/scraper-api';
import { createLogSocket } from '@/lib/scraper-websocket';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { Play, ChevronLeft, AlertCircle, Search, BarChart2, MessageSquare, XCircle } from 'lucide-react';

const COMBOS = [
  { code: 'combo_A', label: 'A', desc: 'IT Manager / CIO' },
  { code: 'combo_B', label: 'B', desc: 'Marketing Director' },
  { code: 'combo_C', label: 'C', desc: 'Digital Transform / CDO' },
  { code: 'combo_D', label: 'D', desc: 'CTO / VP Engineering' },
  { code: 'combo_E', label: 'E', desc: 'E-commerce / Ops' },
  { code: 'combo_G', label: 'G', desc: 'Product / Eng Manager' },
];
const MARKETS = ['Taiwan', 'LATAM', 'Vietnam'];
const ACTIVE_STATUSES: RunStatus[] = ['pending', 'running', 'scoring', 'drafting'];

type Step = 'form' | 'running' | 'result' | 'error';

interface LeadRow { id: string; full_name?: string; company?: string; title?: string; icp_score?: number; temperature?: 'HOT' | 'WARM' | 'COLD'; custom1?: string; }

const PHASE_INFO: Partial<Record<RunStatus, { title: string; icon: React.ReactNode; progress: number }>> = {
  pending:  { title: 'Starting pipeline...',   icon: <Search size={28} />,       progress: 5 },
  running:  { title: 'Scraping LinkedIn...',   icon: <Search size={28} />,       progress: 33 },
  scoring:  { title: 'Scoring leads...',       icon: <BarChart2 size={28} />,    progress: 66 },
  drafting: { title: 'Generating messages...', icon: <MessageSquare size={28} />, progress: 90 },
};

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: '#F0F0F5', maxWidth: 560 },
  card: { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: '20px 24px' },
  sectionLabel: { fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 10 },
};

function comboBtn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all .15s',
    border: `1px solid ${active ? '#6C63FF' : '#2A2A3A'}`,
    backgroundColor: active ? '#6C63FF20' : '#1C1C27',
    color: active ? '#6C63FF' : '#8B8BA0',
  };
}

export default function RunPage() {
  const [step, setStep] = useState<Step>('form');
  const [selectedCombos, setSelectedCombos] = useState<string[]>(['combo_A', 'combo_D']);
  const [market, setMarket] = useState('Taiwan');
  const [limit, setLimit] = useState(80);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>('pending');
  const [leadCount, setLeadCount] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const [run, setRun] = useState<Run | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const toggleCombo = (code: string) =>
    setSelectedCombos(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);

  const handleSubmit = async () => {
    if (!selectedCombos.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await scraperApi.post<{ run_id: string }>('/run/scrape', {
        combos: selectedCombos, market, limit_per_combo: limit,
      });
      setRunId(res.run_id);
      setRunStatus('pending');
      setLeadCount(0);
      setStep('running');

      const ws = createLogSocket(
        res.run_id,
        (log: RunLog) => { const m = log.message.match(/\b(\d+)\s+lead/i); if (m) setLeadCount(parseInt(m[1])); },
        async (status: string) => {
          const s = status as RunStatus;
          setRunStatus(s);
          if (s === 'completed') {
            try {
              const [runData, leadsData] = await Promise.all([
                scraperApi.get<Run>(`/run/${res.run_id}`),
                scraperApi.get<LeadRow[]>(`/leads/?run_id=${res.run_id}&limit=50`),
              ]);
              setRun(runData); setLeads(leadsData); setStep('result');
            } catch { setStep('error'); }
          } else if (s === 'failed' || s === 'cancelled') { setStep('error'); }
        }
      );
      wsRef.current = ws;
    } catch (e) {
      const msg = String(e);
      setSubmitError(msg.includes('fetch') || msg.includes('network') || msg.toLowerCase().includes('failed')
        ? 'No se pudo conectar al backend. Verificá que esté corriendo.'
        : msg);
    } finally { setSubmitting(false); }
  };

  useEffect(() => {
    if (step !== 'running' || !runId) return;
    const id = setInterval(async () => {
      try {
        const r = await scraperApi.get<Run>(`/run/${runId}`);
        setRunStatus(r.status);
        if (r.status === 'completed') {
          clearInterval(id);
          const [runData, leadsData] = await Promise.all([
            scraperApi.get<Run>(`/run/${runId}`),
            scraperApi.get<LeadRow[]>(`/leads/?run_id=${runId}&limit=50`),
          ]);
          setRun(runData); setLeads(leadsData); setStep('result');
        } else if (r.status === 'failed' || r.status === 'cancelled') { clearInterval(id); setStep('error'); }
      } catch { /* backend unavailable */ }
    }, 3000);
    return () => clearInterval(id);
  }, [step, runId]);

  const handleCancel = async () => {
    if (!runId || cancelling) return;
    setCancelling(true);
    try { await scraperApi.post(`/run/${runId}/cancel`, {}); wsRef.current?.close(); setRunStatus('cancelled'); setStep('error'); }
    catch { setStep('error'); }
    finally { setCancelling(false); setCancelConfirm(false); }
  };

  const resetToForm = () => {
    wsRef.current?.close();
    setStep('form'); setRun(null); setLeads([]); setRunId(null);
    setRunStatus('pending'); setLeadCount(0); setCancelConfirm(false);
  };

  /* FORM */
  if (step === 'form') return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Nuevo Pipeline</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <span style={S.sectionLabel}>Search Combos</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {COMBOS.map(c => (
              <button key={c.code} onClick={() => toggleCombo(c.code)} title={c.desc} style={comboBtn(selectedCombos.includes(c.code))}>
                <span style={{ display: 'block', fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>
                  {selectedCombos.includes(c.code) ? '✓ ' : ''}{c.label}
                </span>
                <span style={{ display: 'block', fontSize: 11, opacity: 0.7, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span style={S.sectionLabel}>Market</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {MARKETS.map(m => (
              <button key={m} onClick={() => setMarket(m)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: `1px solid ${market === m ? '#6C63FF' : '#2A2A3A'}`, backgroundColor: market === m ? '#6C63FF' : '#1C1C27', color: market === m ? '#FFF' : '#8B8BA0' }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span style={S.sectionLabel}>Limit per combo</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="number" min={10} max={200} step={10} value={limit} onChange={e => setLimit(Number(e.target.value))}
              style={{ width: 90, padding: '8px 12px', borderRadius: 8, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 13, outline: 'none' }} />
            <span style={{ fontSize: 13, color: '#52526A' }}>leads por combo</span>
          </div>
        </div>

        {submitError && (
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
            <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>No se pudo iniciar</p>
              <p style={{ fontSize: 12, color: '#8B8BA0', margin: 0 }}>{submitError}</p>
            </div>
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting || selectedCombos.length === 0}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', backgroundColor: submitting || !selectedCombos.length ? '#2A2A3A' : '#6C63FF', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: submitting || !selectedCombos.length ? 'default' : 'pointer' }}>
          <Play size={15} /> {submitting ? 'Iniciando...' : 'Run Pipeline'}
        </button>
      </div>
    </div>
  );

  /* RUNNING */
  if (step === 'running') {
    const phase = PHASE_INFO[runStatus] ?? PHASE_INFO.pending!;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, marginTop: 80, color: '#F0F0F5' }}>
        <div style={{ position: 'relative', width: 96, height: 96 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid #2A2A3A' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#6C63FF', animation: 'spin 1s linear infinite' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6C63FF' }}>
            {phase.icon}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}>{phase.title}</p>
          {leadCount > 0 && <p style={{ fontSize: 13, color: '#52526A', margin: 0 }}>{leadCount} leads encontrados hasta ahora</p>}
        </div>
        <div style={{ width: 320 }}>
          <div style={{ height: 4, backgroundColor: '#2A2A3A', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', backgroundColor: '#6C63FF', borderRadius: 2, width: `${phase.progress}%`, transition: 'width .7s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52526A' }}>
            <span style={runStatus === 'running' || runStatus === 'pending' ? { color: '#6C63FF' } : {}}>Scraping</span>
            <span style={runStatus === 'scoring' ? { color: '#6C63FF' } : {}}>Scoring</span>
            <span style={runStatus === 'drafting' ? { color: '#6C63FF' } : {}}>Generating</span>
          </div>
        </div>
        <div>
          {cancelConfirm ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: '#8B8BA0' }}>¿Cancelar este run?</span>
              <button onClick={handleCancel} disabled={cancelling} style={{ fontSize: 12, color: '#EF4444', border: '1px solid #EF444430', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: 'transparent' }}>
                {cancelling ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
              <button onClick={() => setCancelConfirm(false)} style={{ fontSize: 12, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>Seguir</button>
            </div>
          ) : (
            <button onClick={() => setCancelConfirm(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>
              <XCircle size={13} /> Cancelar
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ERROR */
  if (step === 'error') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, marginTop: 80, color: '#F0F0F5' }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: '#EF444415', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AlertCircle size={36} color="#EF4444" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>{runStatus === 'cancelled' ? 'Run cancelado' : 'Algo salió mal'}</p>
        <p style={{ fontSize: 13, color: '#52526A', margin: 0 }}>{runStatus === 'cancelled' ? 'El pipeline fue cancelado.' : 'Revisá los logs para más detalles.'}</p>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={resetToForm} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#6C63FF', color: '#FFF', padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <Play size={13} /> Reintentar
        </button>
        <Link href="/history" style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#8B8BA0', padding: '10px 20px', borderRadius: 8, textDecoration: 'none', fontSize: 13 }}>
          Ver historial
        </Link>
      </div>
    </div>
  );

  /* RESULT */
  return (
    <div style={{ padding: '24px', color: '#F0F0F5', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <StatusBadge status="completed" />
        <span style={{ fontSize: 16, fontWeight: 600 }}>Pipeline completado</span>
      </div>
      {run && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total',  value: run.total_leads, color: '#F0F0F5' },
            { label: 'HOT',    value: run.hot_count,   color: '#EF4444' },
            { label: 'WARM',   value: run.warm_count,  color: '#F59E0B' },
            { label: 'COLD',   value: run.cold_count,  color: '#60A5FA' },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'monospace', color: s.color, margin: '0 0 4px' }}>{s.value}</p>
              <p style={{ fontSize: 11, color: '#52526A', margin: 0 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {leads.length > 0 && (
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'auto', marginBottom: 20 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2A2A3A' }}>
                {['Nombre', 'Empresa', 'Título', 'ICP', 'Temp', 'Mensaje'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#52526A', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 20).map((lead, i) => (
                <tr key={lead.id} style={{ borderTop: i > 0 ? '1px solid #2A2A3A' : undefined }}>
                  <td style={{ padding: '8px 14px', color: '#F0F0F5', fontWeight: 600 }}>{lead.full_name || '—'}</td>
                  <td style={{ padding: '8px 14px', color: '#8B8BA0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                  <td style={{ padding: '8px 14px', color: '#8B8BA0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                  <td style={{ padding: '8px 14px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                  <td style={{ padding: '8px 14px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                  <td style={{ padding: '8px 14px', color: '#52526A', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lead.custom1 || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link href={`/leads?run_id=${runId}`} style={{ backgroundColor: '#6C63FF', color: '#FFF', padding: '9px 18px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>Ver todos los leads →</Link>
        <Link href={`/export?run_id=${runId}`} style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#8B8BA0', padding: '9px 18px', borderRadius: 8, textDecoration: 'none', fontSize: 13 }}>Descargar CSV</Link>
        <button onClick={resetToForm} style={{ fontSize: 13, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 10px' }}>
          <ChevronLeft size={13} style={{ display: 'inline', marginRight: 4 }} />Nuevo run
        </button>
      </div>
    </div>
  );
}
