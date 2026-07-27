'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/scraper/StatusBadge';
import { Play, Activity } from 'lucide-react';
import type { RunRecord, RunStatus } from '@/lib/types';

const ACTIVE_STATUSES = new Set<RunStatus>(['pending', 'running', 'scoring', 'drafting']);

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px', color: 'var(--crm-text-primary)', maxWidth: 900 },
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.3)' },
  label: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  h2: { fontSize: 11, color: 'var(--crm-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12 },
};

export function DashboardClient() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = async () => {
    try {
      const data = await fetch('/api/runs').then(r => r.json());
      setRuns(Array.isArray(data) ? data : []);
    } catch { /* backend not running */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchRuns();
    const id = setInterval(fetchRuns, 10000);
    return () => clearInterval(id);
  }, []);

  const latestRun = runs[0] ?? null;
  const activeRun = runs.find(r => ACTIVE_STATUSES.has(r.status as RunStatus));
  const runMarket = (run: RunRecord) => (run.markets?.length ? run.markets : [run.market]).join(' + ');

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Scraper Dashboard</h1>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Runs', value: runs.length, icon: <Activity size={16} color="var(--crm-accent)" /> },
          { label: 'Total Leads Requested', value: runs.reduce((s, r) => s + (r.total_leads_requested || 0), 0), icon: <Activity size={16} color="#22C55E" /> },
        ].map(s => (
          <div key={s.label} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={S.label}>{s.label}</span>
              {s.icon}
            </div>
            <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', margin: 0, color: 'var(--crm-text-primary)' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Active run banner */}
      {activeRun && (
        <div style={{ borderRadius: 12, border: '1px solid #6C63FF40', backgroundColor: '#6C63FF10', padding: '12px 16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8, gap: 12, marginBottom: 24 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--crm-accent)', animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, color: 'var(--crm-text-primary)', fontWeight: 600, margin: 0 }}>Active run — {runMarket(activeRun)}</p>
            <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeRun.combos?.join(', ')}</p>
          </div>
          <StatusBadge status={activeRun.status as Parameters<typeof StatusBadge>[0]['status']} />
          <Link href="/history" style={{ fontSize: 11, color: 'var(--crm-accent)', whiteSpace: 'nowrap' }}>View history →</Link>
        </div>
      )}

      {/* Latest run */}
      {latestRun && (
        <section style={{ marginBottom: 24 }}>
          <p style={S.h2}>Latest Run</p>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{runMarket(latestRun)}</p>
                <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '4px 0 0' }}>
                  {new Date(latestRun.created_at).toLocaleDateString()} · {latestRun.combos?.join(', ')}
                </p>
              </div>
              <StatusBadge status={latestRun.status as Parameters<typeof StatusBadge>[0]['status']} />
            </div>
            {(latestRun.total_leads_requested ?? 0) > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>{latestRun.total_leads_requested} leads requested</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/history" style={{ fontSize: 12, backgroundColor: 'var(--crm-accent)', color: '#FFF', padding: '6px 14px', borderRadius: 7, textDecoration: 'none', fontWeight: 600 }}>View History</Link>
            </div>
          </div>
        </section>
      )}

      {/* Recent runs */}
      {runs.length > 1 && (
        <section>
          <p style={S.h2}>Recent Runs</p>
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            {runs.slice(1, 6).map((run, i) => (
              <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: i > 0 ? '1px solid var(--crm-border)' : undefined }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runMarket(run)}</p>
                  <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', margin: '2px 0 0' }}>{new Date(run.created_at).toLocaleDateString()} · {run.total_leads_requested} leads req.</p>
                </div>
                <StatusBadge status={run.status as Parameters<typeof StatusBadge>[0]['status']} />
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && <p style={{ color: 'var(--crm-text-muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading...</p>}
      {!loading && runs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <p style={{ color: 'var(--crm-text-muted)', marginBottom: 16 }}>No runs yet.</p>
          <Link href="/run" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--crm-accent)', color: '#FFF', padding: '10px 20px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
            <Play size={14} /> Start first run
          </Link>
        </div>
      )}

      {/* FAB */}
      <Link href="/run" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, backgroundColor: 'var(--crm-accent)', color: '#FFF', padding: '12px 20px', borderRadius: 50, textDecoration: 'none', fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(108,99,255,.4)' }}>
        <Play size={14} /> New Run
      </Link>
    </div>
  );
}
