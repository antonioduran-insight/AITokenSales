'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, Trash2, AlertTriangle } from 'lucide-react'
import type { Area } from '@/lib/types'

/**
 * El padrón de SSO: quién está autorizado a entrar por el IdP de la empresa.
 *
 * Vive junto a Usuarios porque es la misma pregunta en dos tiempos — "quién
 * trabaja acá" y "quién puede empezar a trabajar acá". Una entrada del padrón
 * no es una cuenta: se convierte en una cuando esa persona entra por primera
 * vez, y ahí desaparece de esta lista y aparece en la de arriba.
 *
 * No se renderiza nada si la org no tiene el add-on. La API lo revalida igual:
 * gatear solo en la UI nunca es el límite.
 */

type RosterEntry = {
  id: string
  email: string
  role: 'admin' | 'sdr'
  area_id: string
  workspace_id: string | null
  created_at: string
  area?: Area
}

const S: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)',
    borderRadius: 10, padding: 22, marginTop: 24,
  },
  title: {
    fontSize: 11, fontWeight: 700, color: 'var(--crm-text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
  },
  input: {
    backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
    borderRadius: 6, color: 'var(--crm-text-primary)', padding: '8px 11px',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  btn: {
    backgroundColor: 'var(--crm-accent)', color: '#fff', border: 'none',
    borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
}

export function SsoRoster({ areas }: { areas: Area[] }) {
  const t = useTranslations('sso')
  const [entries, setEntries] = useState<RosterEntry[]>([])
  const [addonActive, setAddonActive] = useState(false)
  const [ssoConfigured, setSsoConfigured] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; is_active: boolean }>>([])

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'sdr'>('sdr')
  const [areaId, setAreaId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sso-roster')
      if (!res.ok) { setLoaded(true); return }
      const d = await res.json()
      setEntries(d.roster ?? [])
      setAddonActive(!!d.addon_active)
      setSsoConfigured(!!d.sso_configured)
    } catch { /* sin add-on, sin panel */ } finally { setLoaded(true) }
  }, [])

  useEffect(() => {
    load()
    createClient().from('workspaces').select('id, name, is_active').then(({ data }) => {
      if (data) setWorkspaces(data)
    })
  }, [load])

  async function add() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/sso-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, area_id: areaId, workspace_id: workspaceId || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error === 'seat_limit_reached' ? t('seatLimit', { max: d.max_seats }) : (d.error ?? t('addFailed')))
        return
      }
      setEmail(''); setWorkspaceId('')
      await load()
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/sso-roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) await load()
    } finally { setBusy(false) }
  }

  if (!loaded || !addonActive) return null

  return (
    <div style={S.card}>
      <p style={S.title}>{t('title')}</p>
      <p style={{ fontSize: 12.5, color: 'var(--crm-text-muted)', margin: '0 0 16px', lineHeight: 1.6 }}>
        {t('help')}
      </p>

      {/* Sin conexión SAML cargada, el padrón no autoriza nada todavía. Decirlo
          es más útil que dejar al admin cargar diez personas que no van a poder
          entrar. */}
      {!ssoConfigured && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 12px', borderRadius: 7, marginBottom: 16, fontSize: 12.5,
          background: '#F59E0B15', border: '1px solid #F59E0B40', color: '#FCD34D',
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t('notConfigured')}</span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '9px 12px', borderRadius: 7, marginBottom: 14, fontSize: 12.5,
          background: '#EF444415', border: '1px solid #EF444440', color: '#EF4444',
        }}>{error}</div>
      )}

      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
          {entries.map(e => (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', rowGap: 6,
              padding: '9px 12px', backgroundColor: 'var(--crm-surface-raised)', borderRadius: 7,
            }}>
              {/* minWidth:0 para que un email largo se recorte en vez de empujar
                  el rol y el botón fuera de la tarjeta. */}
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', fontSize: 13, color: 'var(--crm-text-primary)',
              }}>{e.email}</span>

              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                backgroundColor: e.role === 'admin' ? '#6C63FF20' : 'var(--crm-border)',
                color: e.role === 'admin' ? '#A78BFA' : 'var(--crm-text-secondary)',
              }}>{e.role === 'admin' ? 'Admin' : 'SDR'}</span>

              <span style={{ fontSize: 11.5, color: 'var(--crm-text-muted)', flexShrink: 0 }}>
                {e.area?.label_en ?? '—'}
              </span>

              <button
                onClick={() => remove(e.id)}
                disabled={busy}
                title={t('removeHint')}
                style={{
                  display: 'flex', alignItems: 'center', padding: '5px 9px', borderRadius: 5,
                  fontSize: 12, cursor: 'pointer', flexShrink: 0,
                  border: '1px solid #EF444440', backgroundColor: '#EF444410', color: '#EF4444',
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* `crm-grid-1-mobile`: cuatro columnas en una fila se vuelven ilegibles
          en pantalla angosta, y `gridTemplateColumns` inline no se puede
          sobrescribir por breakpoint de otra forma. */}
      <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
        <input
          value={email}
          onChange={ev => setEmail(ev.target.value)}
          placeholder={t('emailPlaceholder')}
          type="email"
          style={S.input}
        />
        <select value={role} onChange={ev => setRole(ev.target.value as 'admin' | 'sdr')} style={{ ...S.input, cursor: 'pointer' }}>
          <option value="sdr">SDR</option>
          <option value="admin">Admin</option>
        </select>
        <select value={areaId} onChange={ev => setAreaId(ev.target.value)} style={{ ...S.input, cursor: 'pointer' }}>
          <option value="">{t('selectArea')}</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.label_en}</option>)}
        </select>
        {workspaces.filter(w => w.is_active).length > 0 ? (
          <select value={workspaceId} onChange={ev => setWorkspaceId(ev.target.value)} style={{ ...S.input, cursor: 'pointer' }}>
            <option value="">{t('allSites')}</option>
            {workspaces.filter(w => w.is_active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : <div />}
      </div>

      <button
        onClick={add}
        disabled={busy || !email.trim() || !areaId}
        style={{ ...S.btn, marginTop: 12, opacity: busy || !email.trim() || !areaId ? 0.5 : 1 }}
      >
        <KeyRound size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: -1 }} />
        {t('authorise')}
      </button>
    </div>
  )
}
