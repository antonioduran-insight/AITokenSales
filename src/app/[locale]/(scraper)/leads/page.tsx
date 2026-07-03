'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { scraperApi, type Lead, type Run } from '@/lib/scraper-api';
import { TemperatureBadge } from '@/components/scraper/TemperatureBadge';
import { ICPScore } from '@/components/scraper/ICPScore';
import { Copy, Check, X } from 'lucide-react';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6C63FF', background: 'none', border: 'none', cursor: 'pointer' }}>
      {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
    </button>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', color: '#F0F0F5', fontSize: 13, outline: 'none',
};

function LeadsContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get('run_id');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filterRun, setFilterRun] = useState(runIdParam ?? '');
  const [filterTemp, setFilterTemp] = useState('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/leads/?limit=100';
      if (filterRun) url += `&run_id=${filterRun}`;
      if (filterTemp) url += `&temperature=${filterTemp}`;
      setLeads(await scraperApi.get<Lead[]>(url));
    } catch { /* backend */ }
    finally { setLoading(false); }
  }, [filterRun, filterTemp]);

  useEffect(() => { scraperApi.get<Run[]>('/run/?limit=50').then(setRuns).catch(() => {}); }, []);
  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  return (
    <div style={{ padding: '24px', color: '#F0F0F5', maxWidth: 1100 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Scraper Leads</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterRun} onChange={e => setFilterRun(e.target.value)} style={selectStyle}>
          <option value="">All Runs</option>
          {runs.map(r => (
            <option key={r.id} value={r.id}>{r.market} — {new Date(r.created_at).toLocaleDateString()} ({r.total_leads} leads)</option>
          ))}
        </select>
        <select value={filterTemp} onChange={e => setFilterTemp(e.target.value)} style={selectStyle}>
          <option value="">All Temps</option>
          <option value="HOT">🔥 HOT</option>
          <option value="WARM">🌡 WARM</option>
          <option value="COLD">❄️ COLD</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#52526A' }}>{leads.length} leads</span>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#13131A', border: '1px solid #2A2A3A', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2A2A3A' }}>
              {['Name', 'Company', 'Title', 'ICP', 'Temp', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#52526A', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#52526A' }}>Loading...</td></tr>}
            {!loading && leads.length === 0 && <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#52526A' }}>Sin leads.</td></tr>}
            {leads.map((lead, i) => (
              <tr key={lead.id} onClick={() => setSelectedLead(lead)} style={{ borderTop: i > 0 ? '1px solid #2A2A3A' : undefined, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1C1C27')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                <td style={{ padding: '8px 14px', color: '#F0F0F5', fontWeight: 600 }}>{lead.full_name || '—'}</td>
                <td style={{ padding: '8px 14px', color: '#8B8BA0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.company || '—'}</td>
                <td style={{ padding: '8px 14px', color: '#8B8BA0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                <td style={{ padding: '8px 14px' }}><ICPScore score={lead.icp_score ?? 0} size="sm" /></td>
                <td style={{ padding: '8px 14px' }}>{lead.temperature && <TemperatureBadge temperature={lead.temperature} />}</td>
                <td style={{ padding: '8px 14px', color: '#52526A', fontSize: 11 }}>→</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      {selectedLead && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', zIndex: 100 }}>
          <div style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setSelectedLead(null)} />
          <div style={{ width: 480, backgroundColor: '#13131A', borderLeft: '1px solid #2A2A3A', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>{selectedLead.full_name || '—'}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedLead.temperature && <TemperatureBadge temperature={selectedLead.temperature} />}
                  <ICPScore score={selectedLead.icp_score ?? 0} size="lg" />
                  <span style={{ fontSize: 12, color: '#52526A' }}>ICP Score</span>
                </div>
              </div>
              <button onClick={() => setSelectedLead(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52526A' }}><X size={16} /></button>
            </div>

            <div style={{ borderTop: '1px solid #2A2A3A', paddingTop: 16, marginBottom: 16 }}>
              <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Details</p>
              {[
                { label: 'Company',   value: selectedLead.company },
                { label: 'Title',     value: selectedLead.title },
                { label: 'Industry',  value: selectedLead.industry },
                { label: 'Size',      value: selectedLead.company_size },
                { label: 'Location',  value: selectedLead.location },
                { label: 'Email',     value: selectedLead.email },
                { label: 'Combo',     value: selectedLead.search_combo },
              ].map(({ label, value }) => value ? (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#52526A' }}>{label}</span>
                  <span style={{ fontSize: 13, color: '#F0F0F5', textAlign: 'right', maxWidth: 260 }}>{value}</span>
                </div>
              ) : null)}
              {selectedLead.linkedin_url && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#52526A' }}>LinkedIn</span>
                  <a href={selectedLead.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#6C63FF', textDecoration: 'none', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Ver perfil →</a>
                </div>
              )}
            </div>

            <div>
              <p style={{ fontSize: 11, color: '#52526A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Messages</p>
              {[
                { label: 'Connection request', value: selectedLead.custom1 },
                { label: 'Value message',     value: selectedLead.custom2 },
              ].map(({ label, value }) => value ? (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: '#52526A' }}>{label}</span>
                    <CopyButton text={value} />
                  </div>
                  <div style={{ backgroundColor: '#1C1C27', border: '1px solid #2A2A3A', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#8B8BA0', lineHeight: 1.6 }}>
                    {value}
                  </div>
                </div>
              ) : null)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<p style={{ color: '#52526A', padding: 40 }}>Loading...</p>}>
      <LeadsContent />
    </Suspense>
  );
}
