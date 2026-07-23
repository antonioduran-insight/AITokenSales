'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { MARKET_REGIONS, type Market } from '@/lib/types'
import { ChevronDown, ChevronRight } from 'lucide-react'

const S: Record<string, React.CSSProperties> = {
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--crm-text-primary)', marginBottom: 4 },
  hint: { fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 16 },
  btn: { fontSize: 13, fontWeight: 700, color: '#FFF', backgroundColor: 'var(--crm-accent)', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' },
}

function orderRegions(markets: Market[]): string[] {
  const present = [...new Set(markets.map(m => m.region))]
  const known = MARKET_REGIONS.filter(r => present.includes(r)) as string[]
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

  async function save() {
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
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{region}</span>
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
            <button onClick={save} disabled={saving || !dirty}
              style={{ ...S.btn, opacity: saving || !dirty ? 0.45 : 1, cursor: saving || !dirty ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save Markets'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
              {selected.size} market{selected.size !== 1 ? 's' : ''} selected
            </span>
            {saved && <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✓ Saved</span>}
          </div>
        </>
      )}
    </div>
  )
}
