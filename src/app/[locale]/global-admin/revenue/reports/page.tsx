'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { useGlobalAdminTheme } from '@/contexts/GlobalAdminThemeContext'
import { PLAN_PRICES, ADDON_MONTHLY_PRICE, type Organization, type Vendor } from '@/lib/types'
import { quarterDef, billingForQuarter, type FiscalQuarter } from '@/lib/utils/quarter'
import { Download } from 'lucide-react'

type OrgWithAddons = Organization & { addons: string[] }

const SETUP_FEE = 1000
const PARTNERS = { frank: 'Frank Kao', nicolas: 'Nicolás Nicoli' }

// Quarters offered in the selectors (fiscal Q1 = Jul–Sep).
const QUARTER_OPTIONS: { key: string; fq: FiscalQuarter; year: number }[] = [
  { key: 'Q1-2026', fq: 1, year: 2026 },
  { key: 'Q2-2026', fq: 2, year: 2026 },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmt(n: number) { return `$${Math.round(n).toLocaleString()}` }

function planMonthly(org: Organization): number {
  if (org.plan === 'enterprise') return org.custom_price ?? 0
  if (org.plan === 'ultra') return 0
  return PLAN_PRICES[org.plan] ?? 0
}

function addonsMonthly(org: OrgWithAddons): number {
  return (org.addons ?? []).reduce((s, a) => s + (ADDON_MONTHLY_PRICE[a] ?? 0), 0)
}

interface ReportRow {
  org: OrgWithAddons
  isNew: boolean
  setupFee: number
  addonsMonthly: number
  months: number
  mrrThisQuarter: number
  total: number
  vendor: string
}

function buildRows(orgs: OrgWithAddons[], fq: FiscalQuarter, year: number): ReportRow[] {
  const rows: ReportRow[] = []
  for (const org of orgs) {
    if (org.plan === 'ultra') continue // internal / unlimited — not billed
    const billing = billingForQuarter(new Date(org.created_at), fq, year, org.is_active)
    if (!billing.billsThisQuarter) continue

    const pMonthly = planMonthly(org)
    const aMonthly = addonsMonthly(org)
    const months = billing.billableMonths
    const mrrThisQuarter = pMonthly * months
    const setupFee = billing.isNew ? SETUP_FEE : 0
    const total = setupFee + aMonthly * months + mrrThisQuarter
    rows.push({
      org, isNew: billing.isNew, setupFee, addonsMonthly: aMonthly, months,
      mrrThisQuarter, total, vendor: org.vendor || 'Direct',
    })
  }
  return rows.sort((a, b) => b.total - a.total)
}

function loadInfraQuarter(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem('ga_monthly_costs')
    if (!raw) return 0
    const c = JSON.parse(raw)
    const monthly = (c.vercel || 0) + (c.supabase || 0) + (c.railway || 0) + (c.apify || 0) + (c.claude || 0)
    return monthly * 3
  } catch { return 0 }
}

export default function ReportsPage() {
  const { colors } = useGlobalAdminTheme()
  const locale = useLocale()

  const [orgs, setOrgs] = useState<OrgWithAddons[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'quarter' | 'vendor'>('quarter')
  const [quarterKey, setQuarterKey] = useState('Q1-2026')
  const [vendorName, setVendorName] = useState('')
  const [infraQuarter, setInfraQuarter] = useState(0)

  useEffect(() => {
    setInfraQuarter(loadInfraQuarter())
    fetch('/api/global-admin/reports')
      .then(r => r.json())
      .then(d => {
        setOrgs(Array.isArray(d.orgs) ? d.orgs : [])
        setVendors(Array.isArray(d.vendors) ? d.vendors : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const qOpt = QUARTER_OPTIONS.find(q => q.key === quarterKey) ?? QUARTER_OPTIONS[0]
  const qdef = quarterDef(qOpt.fq, qOpt.year)

  const commissionOf = (name: string) => vendors.find(v => v.name === name)?.commission_pct ?? 0

  const allRows = useMemo(() => buildRows(orgs, qOpt.fq, qOpt.year), [orgs, qOpt.fq, qOpt.year])
  const rows = mode === 'vendor' && vendorName ? allRows.filter(r => r.vendor === vendorName) : allRows

  // ── Split computation (per-org) ──────────────────────────────────────────
  // With a vendor: the vendor takes its real commission_pct of that org's
  // revenue; the remainder (100% − pct) is split 50/50 between Frank & Nicolás.
  // Direct sale: Frank & Nicolás split the full revenue 50/50.
  // e.g. vendor 15% → Frank 42.5% / Nicolás 42.5% / Vendor 15%.
  const split = useMemo(() => {
    let frankGross = 0, nicoGross = 0
    const vendorTotals = new Map<string, number>()
    for (const r of rows) {
      const hasVendor = r.vendor !== 'Direct'
      const pct = hasVendor ? commissionOf(r.vendor) / 100 : 0
      const partnerShare = (r.total * (1 - pct)) / 2
      frankGross += partnerShare
      nicoGross += partnerShare
      if (hasVendor) {
        vendorTotals.set(r.vendor, (vendorTotals.get(r.vendor) ?? 0) + r.total * pct)
      }
    }
    return { frankGross, nicoGross, vendorTotals }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, vendors])

  const gross = rows.reduce((s, r) => s + r.total, 0)
  const net = gross - infraQuarter

  // Infra costs come off the general total before the split, hitting every
  // party (Frank, Nicolás and vendors) proportionally to their gross share.
  const infraScale = gross > 0 ? Math.max(0, net) / gross : 0
  const frankFinal = split.frankGross * infraScale
  const nicoFinal = split.nicoGross * infraScale
  const vendorFinal = (name: string) => (split.vendorTotals.get(name) ?? 0) * infraScale

  // Vendor-mode summary
  const vendorSales = mode === 'vendor' ? rows.reduce((s, r) => s + r.total, 0) : 0
  const vendorPct = mode === 'vendor' && vendorName ? commissionOf(vendorName) : 0
  const vendorCommission = vendorSales * (vendorPct / 100)

  const activeVendors = vendors.filter(v => v.is_active)

  // ── Export PDF (browser print → Save as PDF) ──
  function exportPdf() {
    const title = mode === 'vendor'
      ? `Sales Report — ${vendorName || 'Vendor'} — ${qdef.label}`
      : `Revenue Report — ${qdef.label}`

    const head = ['Organization', 'Plan', 'Sale Date', 'New?', 'Setup', 'Add-ons/mo', 'Months', 'MRR (Q)', 'Total', 'Vendor']
    const bodyRows = rows.map(r => [
      r.org.name,
      r.org.plan,
      new Date(r.org.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }),
      r.isNew ? 'Yes' : 'No',
      r.isNew ? fmt(r.setupFee) : '—',
      r.addonsMonthly > 0 ? fmt(r.addonsMonthly) : '—',
      String(r.months),
      fmt(r.mrrThisQuarter),
      fmt(r.total),
      r.vendor,
    ])

    let summary = ''
    if (mode === 'vendor') {
      summary = `
        <table class="sum">
          <tr><td>Total Sales by ${escapeHtml(vendorName)} this ${qdef.label}</td><td class="r">${fmt(vendorSales)}</td></tr>
          <tr><td>Commission (${vendorPct}%)</td><td class="r">${fmt(vendorCommission)}</td></tr>
        </table>`
    } else {
      const vendorLines = [...split.vendorTotals.keys()]
        .map(n => `<tr><td>${escapeHtml(n)} (${commissionOf(n)}%)</td><td class="r">${fmt(vendorFinal(n))}</td></tr>`).join('')
      summary = `
        <table class="sum">
          <tr><td>Gross Revenue Total</td><td class="r">${fmt(gross)}</td></tr>
          <tr><td>− Infrastructure Costs</td><td class="r">-${fmt(infraQuarter)}</td></tr>
          <tr class="tot"><td>= Net Revenue</td><td class="r">${fmt(net)}</td></tr>
        </table>
        <h3>Split (net of infra)</h3>
        <table class="sum">
          <tr><td>${PARTNERS.frank}</td><td class="r">${fmt(frankFinal)}</td></tr>
          <tr><td>${PARTNERS.nicolas}</td><td class="r">${fmt(nicoFinal)}</td></tr>
          ${vendorLines}
        </table>`
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:32px;}
        h1{font-size:20px;margin:0 0 4px;} .meta{color:#666;font-size:12px;margin-bottom:20px;}
        h3{font-size:14px;margin:20px 0 8px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th,td{padding:6px 8px;border-bottom:1px solid #e0e0e0;text-align:left;}
        th{background:#f4f4f4;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#555;}
        td.r,th.r{text-align:right;}
        table.sum{width:320px;margin-top:4px;} table.sum td{border-bottom:1px solid #eee;}
        table.sum tr.tot td{font-weight:700;border-top:2px solid #333;}
        @media print{body{padding:0;}}
      </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${qdef.label} · ${MONTH_NAMES[qdef.months[0]]}–${MONTH_NAMES[qdef.months[2]]} · Generated ${new Date().toLocaleDateString()}</div>
      <table><thead><tr>${head.map((h, i) => `<th class="${i >= 4 && i <= 8 ? 'r' : ''}">${h}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows.map(row => `<tr>${row.map((c, i) => `<td class="${i >= 4 && i <= 8 ? 'r' : ''}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${summary}
      </body></html>`

    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const card: React.CSSProperties = { backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10 }
  const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, color: colors.textPrimary, borderBottom: `1px solid ${colors.surfaceRaised}`, whiteSpace: 'nowrap' }
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: active ? colors.accent : colors.surfaceRaised, color: active ? '#fff' : colors.textSecondary })
  const selectStyle: React.CSSProperties = { backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}`, color: colors.textPrimary, borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none' }

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <Link href={`/${locale}/global-admin/revenue`} style={{ ...tabBtn(false), textDecoration: 'none' }}>Overview</Link>
        <span style={tabBtn(true)}>Reports</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>Reports</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setMode('quarter')} style={tabBtn(mode === 'quarter')}>By Quarter</button>
          <button onClick={() => setMode('vendor')} style={tabBtn(mode === 'vendor')}>By Vendor</button>
        </div>
      </div>

      {/* Selectors */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {mode === 'vendor' && (
          <select value={vendorName} onChange={e => setVendorName(e.target.value)} style={selectStyle}>
            <option value="">Select vendor…</option>
            {activeVendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        )}
        <select value={quarterKey} onChange={e => setQuarterKey(e.target.value)} style={selectStyle}>
          {QUARTER_OPTIONS.map(q => <option key={q.key} value={q.key}>{`Q${q.fq} ${q.year}`}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={exportPdf} disabled={rows.length === 0 || (mode === 'vendor' && !vendorName)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: colors.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: rows.length === 0 ? 'default' : 'pointer', opacity: rows.length === 0 || (mode === 'vendor' && !vendorName) ? 0.4 : 1 }}>
          <Download size={14} /> Export PDF
        </button>
      </div>

      {loading ? (
        <div style={{ color: colors.textSecondary, padding: 60, textAlign: 'center' }}>Loading…</div>
      ) : mode === 'vendor' && !vendorName ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: colors.textMuted }}>Select a vendor to see their sales.</div>
      ) : (
        <>
          {/* Table */}
          <div style={{ ...card, overflow: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Organization', 'Plan', 'Sale Date', 'New this Q?', 'Setup Fee', 'Add-ons/mo', 'Months', 'MRR this Q', 'Total', 'Vendor'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i >= 4 && i <= 8 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.org.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.org.name}</td>
                    <td style={{ ...td, textTransform: 'uppercase', fontSize: 10, fontWeight: 700, color: colors.textSecondary }}>{r.org.plan}</td>
                    <td style={{ ...td, color: colors.textSecondary }}>{new Date(r.org.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td style={{ ...td, textAlign: 'right', color: r.isNew ? colors.success : colors.textMuted, fontWeight: 600 }}>{r.isNew ? 'Yes' : 'No'}</td>
                    <td style={{ ...td, textAlign: 'right', color: r.isNew ? '#F59E0B' : colors.textMuted }}>{r.isNew ? fmt(r.setupFee) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.textSecondary }}>{r.addonsMonthly > 0 ? fmt(r.addonsMonthly) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.textSecondary }}>{r.months}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.success, fontWeight: 600 }}>{fmt(r.mrrThisQuarter)}</td>
                    <td style={{ ...td, textAlign: 'right', color: colors.textPrimary, fontWeight: 700 }}>{fmt(r.total)}</td>
                    <td style={{ ...td, color: colors.textSecondary }}>{r.vendor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: colors.textMuted, fontSize: 14 }}>No organizations billed in {qdef.label}.</div>}
          </div>

          {/* Summary */}
          {rows.length > 0 && (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {mode === 'vendor' ? (
                <div style={{ ...card, padding: '18px 22px', minWidth: 320 }}>
                  <SummaryRow label={`Total Sales by ${vendorName} this ${qdef.label}`} value={fmt(vendorSales)} colors={colors} bold />
                  <SummaryRow label={`Commission (${vendorPct}%)`} value={fmt(vendorCommission)} colors={colors} color="#F59E0B" bold />
                </div>
              ) : (
                <>
                  <div style={{ ...card, padding: '18px 22px', flex: 1, minWidth: 280 }}>
                    <SummaryRow label="Gross Revenue Total" value={fmt(gross)} colors={colors} bold />
                    <SummaryRow label="− Infrastructure Costs" value={`-${fmt(infraQuarter)}`} colors={colors} color="#EF4444" />
                    <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 6 }}>
                      <SummaryRow label="= Net Revenue" value={fmt(net)} colors={colors} color={colors.accent} bold />
                    </div>
                  </div>
                  <div style={{ ...card, padding: '18px 22px', flex: 1, minWidth: 280 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Split <span style={{ fontWeight: 400, textTransform: 'none' }}>· net of infra</span></div>
                    <SummaryRow label={PARTNERS.frank} value={fmt(frankFinal)} colors={colors} />
                    <SummaryRow label={PARTNERS.nicolas} value={fmt(nicoFinal)} colors={colors} />
                    {[...split.vendorTotals.keys()].map(n => (
                      <SummaryRow key={n} label={`${n} (${commissionOf(n)}%)`} value={fmt(vendorFinal(n))} colors={colors} color="#F59E0B" />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryRow({ label, value, colors, color, bold }: { label: string; value: string; colors: ReturnType<typeof useGlobalAdminTheme>['colors']; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
      <span style={{ fontSize: 13, color: colors.textSecondary }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 600, color: color ?? colors.textPrimary }}>{value}</span>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
