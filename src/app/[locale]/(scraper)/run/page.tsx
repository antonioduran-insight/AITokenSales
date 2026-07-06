'use client';

import { useState, useEffect, useRef } from 'react';
import { Link } from '@/i18n/navigation';
import { scraperApi, type Run, type RunLog, type RunStatus } from '@/lib/scraper-api';
import { createLogSocket } from '@/lib/scraper-websocket';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { Play, ChevronLeft, AlertCircle, Search, BarChart2, MessageSquare, XCircle, DatabaseZap, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/contexts/UserContext';
import type { Area, User, ScraperComboMaster } from '@/lib/types';

const MARKETS = ['Taiwan', 'LATAM', 'Vietnam'];
const LEAD_OPTIONS = [100, 200, 300, 400, 500];
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
  page:         { padding: '24px', color: '#F0F0F5', maxWidth: 580 },
  card:         { backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 12, padding: '20px 24px' },
  sectionLabel: { fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 10 },
};

function comboBtn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all .15s',
    border: `1px solid ${active ? '#6C63FF' : '#2A2A3A'}`,
    backgroundColor: active ? '#6C63FF20' : '#1C1C27',
    color: active ? '#6C63FF' : '#8B8BA0',
    textAlign: 'left' as const,
  };
}

function chipBtn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    border: `1px solid ${active ? '#6C63FF' : '#2A2A3A'}`,
    backgroundColor: active ? '#6C63FF' : '#1C1C27',
    color: active ? '#FFF' : '#8B8BA0',
  };
}

export default function RunPage() {
  const { user, orgPlan } = useUser();
  const isAdmin = user?.role === 'admin';

  const [step, setStep] = useState<Step>('form');
  const [activeCombos, setActiveCombos] = useState<ScraperComboMaster[]>([]);
  const [combosLoading, setCombosLoading] = useState(true);
  const [selectedCombos, setSelectedCombos] = useState<string[]>([]);
  const [market, setMarket] = useState('Taiwan');
  const [totalLeads, setTotalLeads] = useState(200);
  const [selectedSdrIds, setSelectedSdrIds] = useState<string[]>([]);
  const [sdrs, setSdrs] = useState<User[]>([]);
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

  const [areas, setAreas] = useState<Area[]>([]);
  const [crmAreaId, setCrmAreaId] = useState('');
  const [crmSdrId, setCrmSdrId] = useState('');
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmResult, setCrmResult] = useState<{ imported: number; duplicates: number; no_name: number } | null>(null);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [showCrmForm, setShowCrmForm] = useState(false);

  const showSdrSection = isAdmin && orgPlan !== 'basic';
  const leadsPerCombo = selectedCombos.length > 0 ? Math.floor(totalLeads / selectedCombos.length) : 0;

  useEffect(() => {
    fetch('/api/scraper-combos')
      .then(r => r.json())
      .then((data: ScraperComboMaster[]) => {
        const active = data.filter(c => c.org_active);
        setActiveCombos(active);
        setSelectedCombos(active.slice(0, 2).map(c => c.code));
      })
      .catch(() => {})
      .finally(() => setCombosLoading(false));

    const supabase = createClient();
    supabase.from('areas').select('*').then(({ data }) => { if (data) setAreas(data as Area[]) });
  }, []);

  useEffect(() => {
    if (!showSdrSection) return;
    const supabase = createClient();
    supabase
      .from('users')
      .select('*')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .eq('scraper_access', true)
      .then(({ data }) => { if (data) setSdrs(data as User[]) });
  }, [showSdrSection]);

  const handleImportToCRM = async () => {
    if (!crmAreaId || !runId) return;
    setCrmLoading(true); setCrmError(null); setCrmResult(null);
    try {
      const res = await fetch('/api/scraper/to-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, area_id: crmAreaId, assigned_to: crmSdrId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setCrmError(data.error ?? 'Error al importar');
      else { setCrmResult(data); setShowCrmForm(false); }
    } catch (e) {
      setCrmError(String(e));
    } finally { setCrmLoading(false); }
  };

  const toggleCombo = (code: string) =>
    setSelectedCombos(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);

  const toggleSdr = (id: string) =>
    setSelectedSdrIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const handleSubmit = async () => {
    if (!selectedCombos.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          combos: selectedCombos,
          market,
          total_leads: totalLeads,
          sdr_ids: selectedSdrIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data);
        setSubmitError(errMsg);
        return;
      }
      setRunId(data.run_id);
      setRunStatus('pending');
      setLeadCount(0);
      setStep('running');

      const ws = createLogSocket(
        data.run_id,
        (log: RunLog) => { const m = log.message.match(/\b(\d+)\s+lead/i); if (m) setLeadCount(parseInt(m[1])); },
        async (status: string) => {
          const s = status as RunStatus;
          setRunStatus(s);
          if (s === 'completed') {
            try {
              const [runData, leadsData] = await Promise.all([
                scraperApi.get<Run>(`/runs/${data.run_id}`),
                scraperApi.get<LeadRow[]>(`/leads/?run_id=${data.run_id}&limit=50`),
              ]);
              setRun(runData); setLeads(leadsData); setStep('result');
            } catch { setStep('error'); }
          } else if (s === 'failed' || s === 'cancelled') { setStep('error'); }
        }
      );
      wsRef.current = ws;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  };

  useEffect(() => {
    if (step !== 'running' || !runId) return;
    const id = setInterval(async () => {
      try {
        const r = await scraperApi.get<Run>(`/runs/${runId}`);
        setRunStatus(r.status);
        if (r.status === 'completed') {
          clearInterval(id);
          const [runData, leadsData] = await Promise.all([
            scraperApi.get<Run>(`/runs/${runId}`),
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
    try { await scraperApi.post(`/runs/${runId}/cancel`, {}); wsRef.current?.close(); setRunStatus('cancelled'); setStep('error'); }
    catch { setStep('error'); }
    finally { setCancelling(false); setCancelConfirm(false); }
  };

  const resetToForm = () => {
    wsRef.current?.close();
    setStep('form'); setRun(null); setLeads([]); setRunId(null);
    setRunStatus('pending'); setLeadCount(0); setCancelConfirm(false);
    setCrmResult(null); setShowCrmForm(false);
  };

  /* FORM */
  if (step === 'form') return (
    <div style={S.page}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>New Pipeline</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Market */}
        <div>
          <span style={S.sectionLabel}>Market</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {MARKETS.map(m => (
              <button key={m} onClick={() => setMarket(m)} style={chipBtn(market === m)}>{m}</button>
            ))}
          </div>
        </div>

        {/* Search Combos */}
        <div>
          <span style={S.sectionLabel}>Search Combos</span>
          {combosLoading ? (
            <p style={{ fontSize: 13, color: '#52526A' }}>Loading combos…</p>
          ) : activeCombos.length === 0 ? (
            <p style={{ fontSize: 13, color: '#52526A' }}>
              No active combos. Enable them in <Link href="/settings?tab=scraper" style={{ color: '#6C63FF', textDecoration: 'none' }}>Settings → Scraper</Link>.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {activeCombos.map(c => (
                <button key={c.code} onClick={() => toggleCombo(c.code)} style={comboBtn(selectedCombos.includes(c.code))}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>
                    {selectedCombos.includes(c.code) ? '✓ ' : ''}{c.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, opacity: 0.7, marginTop: 2 }}>{c.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Total Leads */}
        <div>
          <span style={S.sectionLabel}>Total Leads</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {LEAD_OPTIONS.map(n => (
              <button key={n} onClick={() => setTotalLeads(n)} style={chipBtn(totalLeads === n)}>{n}</button>
            ))}
          </div>
          {selectedCombos.length > 0 && (
            <p style={{ fontSize: 12, color: '#52526A', margin: 0 }}>
              {totalLeads} leads total · ~{leadsPerCombo} per combo ({selectedCombos.length} combos selected)
            </p>
          )}
        </div>

        {/* Assign SDRs (Premium+, admin only) */}
        {showSdrSection && (
          <div>
            <span style={S.sectionLabel}>Assign SDRs</span>
            {sdrs.length === 0 ? (
              <p style={{ fontSize: 13, color: '#52526A' }}>No SDRs with scraper access enabled.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sdrs.map(sdr => (
                    <label key={sdr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, backgroundColor: selectedSdrIds.includes(sdr.id) ? '#6C63FF15' : '#1C1C27', border: `1px solid ${selectedSdrIds.includes(sdr.id) ? '#6C63FF40' : '#2A2A3A'}`, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedSdrIds.includes(sdr.id)}
                        onChange={() => toggleSdr(sdr.id)}
                        style={{ accentColor: '#6C63FF', width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#F0F0F5' }}>{sdr.full_name}</span>
                    </label>
                  ))}
                </div>
                {selectedSdrIds.length > 0 && (
                  <p style={{ fontSize: 12, color: '#52526A', marginTop: 8 }}>
                    {totalLeads} leads → {selectedSdrIds.map((id, i) => {
                      const sdr = sdrs.find(s => s.id === id);
                      return `${sdr?.full_name ?? id}: ${Math.floor(totalLeads / selectedSdrIds.length)}`;
                    }).join(' · ')}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {submitError && (
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 10, backgroundColor: '#EF444410', border: '1px solid #EF444430' }}>
            <AlertCircle size={16} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 13, color: '#EF4444', fontWeight: 600, margin: '0 0 4px' }}>Could not start pipeline</p>
              <p style={{ fontSize: 12, color: '#8B8BA0', margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' }}>{submitError}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || selectedCombos.length === 0 || totalLeads === 0}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', backgroundColor: submitting || !selectedCombos.length ? '#2A2A3A' : '#6C63FF', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: submitting || !selectedCombos.length ? 'default' : 'pointer' }}>
          <Play size={15} /> {submitting ? 'Starting…' : 'Run Pipeline'}
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
          {leadCount > 0 && <p style={{ fontSize: 13, color: '#52526A', margin: 0 }}>{leadCount} leads found so far</p>}
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
              <span style={{ fontSize: 12, color: '#8B8BA0' }}>Cancel this run?</span>
              <button onClick={handleCancel} disabled={cancelling} style={{ fontSize: 12, color: '#EF4444', border: '1px solid #EF444430', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', backgroundColor: 'transparent' }}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button onClick={() => setCancelConfirm(false)} style={{ fontSize: 12, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>Keep running</button>
            </div>
          ) : (
            <button onClick={() => setCancelConfirm(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer' }}>
              <XCircle size={13} /> Cancel
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
        <p style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>{runStatus === 'cancelled' ? 'Run cancelled' : 'Something went wrong'}</p>
        <p style={{ fontSize: 13, color: '#52526A', margin: 0 }}>{runStatus === 'cancelled' ? 'The pipeline was cancelled.' : 'Check the logs for details.'}</p>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={resetToForm} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#6C63FF', color: '#FFF', padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <Play size={13} /> Try again
        </button>
        <Link href="/history" style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#8B8BA0', padding: '10px 20px', borderRadius: 8, textDecoration: 'none', fontSize: 13 }}>
          View history
        </Link>
      </div>
    </div>
  );

  /* RESULT */
  return (
    <div style={{ padding: '24px', color: '#F0F0F5', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <StatusBadge status="completed" />
        <span style={{ fontSize: 16, fontWeight: 600 }}>Pipeline completed</span>
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
                {['Name', 'Company', 'Title', 'ICP', 'Temp', 'Message'].map(h => (
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
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Link href={`/leads?run_id=${runId}`} style={{ backgroundColor: '#6C63FF', color: '#FFF', padding: '9px 18px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>View all leads →</Link>
        {!crmResult && (
          <button onClick={() => setShowCrmForm(f => !f)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: showCrmForm ? '#2A2A3A' : '#22C55E20', border: `1px solid ${showCrmForm ? '#2A2A3A' : '#22C55E40'}`, color: showCrmForm ? '#8B8BA0' : '#22C55E', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <DatabaseZap size={14} />{showCrmForm ? 'Cancel' : 'Import to CRM'}
          </button>
        )}
        <button onClick={resetToForm} style={{ fontSize: 13, color: '#52526A', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 10px' }}>
          <ChevronLeft size={13} style={{ display: 'inline', marginRight: 4 }} />New run
        </button>
      </div>

      {crmResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#14532D20', border: '1px solid #16A34A40', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <CheckCircle2 size={16} color="#22C55E" />
          <span style={{ fontSize: 13, color: '#22C55E', fontWeight: 600 }}>Imported: {crmResult.imported}</span>
          <span style={{ fontSize: 13, color: '#52526A' }}>Duplicates: {crmResult.duplicates}</span>
          {crmResult.no_name > 0 && <span style={{ fontSize: 13, color: '#52526A' }}>No name: {crmResult.no_name}</span>}
        </div>
      )}

      {showCrmForm && !crmResult && (
        <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', margin: 0, letterSpacing: '0.06em' }}>Import to CRM</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, color: '#8B8BA0', display: 'block', marginBottom: 4 }}>Area *</label>
              <select value={crmAreaId} onChange={e => setCrmAreaId(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 12, outline: 'none' }}>
                <option value="">Select…</option>
                {areas.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.label_en}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, color: '#8B8BA0', display: 'block', marginBottom: 4 }}>Assign to SDR (optional)</label>
              <select value={crmSdrId} onChange={e => setCrmSdrId(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 12, outline: 'none' }}>
                <option value="">Unassigned</option>
                {sdrs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          </div>
          {crmError && <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{crmError}</p>}
          <button onClick={handleImportToCRM} disabled={!crmAreaId || crmLoading}
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, backgroundColor: !crmAreaId || crmLoading ? '#2A2A3A' : '#22C55E', color: '#FFF', padding: '8px 18px', borderRadius: 8, border: 'none', cursor: !crmAreaId || crmLoading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: !crmAreaId ? 0.5 : 1 }}>
            <DatabaseZap size={14} />{crmLoading ? 'Importing…' : 'Import to CRM'}
          </button>
        </div>
      )}
    </div>
  );
}
