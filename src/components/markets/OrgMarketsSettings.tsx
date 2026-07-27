'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { createClient } from '@/lib/supabase/client'
import { AREA_NAMES, type Market } from '@/lib/types'
import { areaLabel } from '@/lib/utils/area-inference'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'

interface MarketImpact { leads: number; sdrs: number; activeRuns: number }

const ACTIVE_RUN_STATUSES = ['pending', 'running', 'scoring', 'drafting']

// QA-F30: deactivating a market used to be a silent checkbox toggle — no
// warning about existing leads/runs that depend on it. Scoped to the
// current org (RLS-enforced via the browser client), same as the rest of
// this component.
async function fetchDeactivationImpact(marketNames: string[]): Promise<Record<string, MarketImpact>> {
  const supabase = createClient()
  const results: Record<string, MarketImpact> = {}
  await Promise.all(marketNames.map(async name => {
    const [{ data: prospects }, { count: activeRuns }] = await Promise.all([
      supabase.from('prospects').select('assigned_to').eq('market', name),
      supabase.from('runs').select('id', { count: 'exact', head: true }).contains('markets', [name]).in('status', ACTIVE_RUN_STATUSES),
    ])
    const sdrSet = new Set((prospects ?? []).map(p => p.assigned_to).filter(Boolean))
    results[name] = { leads: prospects?.length ?? 0, sdrs: sdrSet.size, activeRuns: activeRuns ?? 0 }
  }))
  return results
}

const S: Record<string, React.CSSProperties> = {
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--crm-text-primary)', marginBottom: 4 },
  hint: { fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 16 },
  btn: { fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' },
}

function orderRegions(markets: Market[]): string[] {
  const present = [...new Set(markets.map(m => m.region))]
  const known = (AREA_NAMES as readonly string[]).filter(r => present.includes(r))
  const rest = present.filter(r => !known.includes(r)).sort()
  return [...known, ...rest]
}

/**
 * Markets card for Settings → Organization: the full catalogue grouped into
 * collapsible regions, with the organization's current selection checked.
 * Saving syncs `organization_markets` (adds the newly checked, removes the
 * unchecked) through PUT /api/organizations/{id}/markets.
 */
export function OrgMarketsSettings() {
  const { user } = useUser()
  const orgId = user?.organization_id ?? null

  const [catalogue, setCatalogue] = useState<Market[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingImpact, setCheckingImpact] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ names: string[]; impact: Record<string, MarketImpact> } | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      try {
        const [allRes, mineRes] = await Promise.all([
          fetch('/api/markets'),
          fetch(`/api/organizations/${orgId}/markets`),
        ])
        const all = await allRes.json()
        const mine = await mineRes.json()
        if (!allRes.ok) throw new Error(all?.error ?? 'Could not load the markets catalogue')
        if (!mineRes.ok) throw new Error(mine?.error ?? 'Could not load your markets')
        if (cancelled) return
        setCatalogue(Array.isArray(all) ? all : [])
        const ids = new Set<string>((Array.isArray(mine) ? mine : []).map((m: Market) => m.id))
        setSelected(ids)
        setInitial(ids)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orgId])

  const regions = useMemo(() => orderRegions(catalogue), [catalogue])

  const dirty = selected.size !== initial.size || [...selected].some(id => !initial.has(id))

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setSaved(false)
  }

  function toggleRegion(region: string, on: boolean) {
    const ids = catalogue.filter(m => m.region === region).map(m => m.id)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
    setSaved(false)
  }

  function toggleCollapse(region: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region); else next.add(region)
      return next
    })
  }

  async function commitSave() {
    if (!orgId || saving) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/markets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market_ids: [...selected] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not save markets')
      setInitial(new Set(selected))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Gatekeeper for the Save button: if any previously-active market is
  // being turned off, check its impact first and require an explicit
  // confirmation instead of silently deactivating it.
  async function handleSaveClick() {
    const deactivatedIds = [...initial].filter(id => !selected.has(id))
    if (deactivatedIds.length === 0) { await commitSave(); return }

    setCheckingImpact(true)
    const names = deactivatedIds
      .map(id => catalogue.find(m => m.id === id)?.name)
      .filter((n): n is string => !!n)
    const impact = await fetchDeactivationImpact(names)
    setCheckingImpact(false)
    setConfirmDeactivate({ names, impact })
  }

  async function confirmAndSave() {
    setConfirmDeactivate(null)
    await commitSave()
  }

  return (
    <div style={S.card}>
      <p style={S.title}>Markets</p>
      <p style={S.hint}>
        Choose the countries your team targets. These are the markets offered when starting a scraper run or building a Bridge seed list.
      </p>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>Loading markets…</p>
      ) : catalogue.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', margin: 0 }}>
          The markets catalogue is empty. {error ? '' : 'Contact support.'}
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {regions.map(region => {
              const inRegion = catalogue.filter(m => m.region === region)
              const chosen = inRegion.filter(m => selected.has(m.id)).length
              const isCollapsed = collapsed.has(region)
              const allOn = chosen === inRegion.length && inRegion.length > 0
              return (
                <div key={region} style={{ border: '1px solid var(--crm-border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: 'var(--crm-surface-raised)' }}>
                    <button onClick={() => toggleCollapse(region)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crm-text-primary)', flex: 1, textAlign: 'left', padding: 0 }}>
                      {isCollapsed ? <ChevronRight size={15} color="var(--crm-text-muted)" /> : <ChevronDown size={15} color="var(--crm-text-muted)" />}
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{areaLabel(region)}</span>
                      <span style={{ fontSize: 11, color: chosen > 0 ? 'var(--crm-accent)' : 'var(--crm-text-muted)', fontWeight: 600 }}>
                        {chosen}/{inRegion.length}
                      </span>
                    </button>
                    <button onClick={() => toggleRegion(region, !allOn)}
                      style={{ fontSize: 11, fontWeight: 600, color: 'var(--crm-text-secondary)', background: 'none', border: '1px solid var(--crm-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                      {allOn ? 'Clear' : 'Select all'}
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4, padding: '12px 14px' }}>
                      {inRegion.map(m => (
                        <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--crm-text-primary)' }}>
                          <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)}
                            style={{ accentColor: 'var(--crm-accent)', width: 14, height: 14, flexShrink: 0 }} />
                          {m.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {error && <p style={{ color: '#EF4444', fontSize: 13, margin: '14px 0 0' }}>{error}</p>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button onClick={handleSaveClick} disabled={saving || checkingImpact || !dirty}
              style={{ ...S.btn, opacity: saving || checkingImpact || !dirty ? 0.45 : 1, cursor: saving || checkingImpact || !dirty ? 'default' : 'pointer' }}>
              {checkingImpact ? 'Checking…' : saving ? 'Saving…' : 'Save Markets'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
              {selected.size} market{selected.size !== 1 ? 's' : ''} selected
            </span>
            {saved && <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✓ Saved</span>}
          </div>
        </>
      )}

      {/* QA-F30: shows what depends on each market being turned off before
          it's actually deactivated. */}
      {confirmDeactivate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: 480, maxWidth: '92vw', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={16} color="#F59E0B" />
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--crm-text-primary)', margin: 0 }}>
                Deactivate {confirmDeactivate.names.length} market{confirmDeactivate.names.length !== 1 ? 's' : ''}?
              </h3>
            </div>
            <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', margin: '0 0 14px' }}>
              Existing leads and runs keep their market — this only stops it from being offered for new runs and seed lists.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {confirmDeactivate.names.map(name => {
                const impact = confirmDeactivate.impact[name]
                const hasImpact = !!impact && (impact.leads > 0 || impact.sdrs > 0 || impact.activeRuns > 0)
                return (
                  <div key={name} style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: 'var(--crm-surface-raised)', border: `1px solid ${hasImpact ? '#F59E0B40' : 'var(--crm-border)'}` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-primary)', marginBottom: 4 }}>{name}</div>
                    <div style={{ fontSize: 12, color: hasImpact ? '#F59E0B' : 'var(--crm-text-muted)' }}>
                      {impact
                        ? `${impact.leads} lead${impact.leads !== 1 ? 's' : ''} · ${impact.sdrs} SDR${impact.sdrs !== 1 ? 's' : ''} with leads here · ${impact.activeRuns} active run${impact.activeRuns !== 1 ? 's' : ''}`
                        : 'No usage found.'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmDeactivate(null)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={confirmAndSave}
                disabled={saving}
                style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: '#EF4444', color: '#FFF', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
