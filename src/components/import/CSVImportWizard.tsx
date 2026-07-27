'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { useUser } from '@/contexts/UserContext'
import { Button } from '@/components/ui/button'
import { UploadCloud, CheckCircle, ChevronRight, ChevronLeft, SkipForward, AlertTriangle } from 'lucide-react'
import Papa from 'papaparse'
import type { AreaName } from '@/lib/types'
import { AREA_NAMES } from '@/lib/types'
import { AREA_LABELS } from '@/lib/utils/area-inference'
import { SEARCH_COMBOS, LEAD_TEMPERATURES } from '@/lib/types'

interface SdrOption {
  id: string
  full_name: string
  area_id: string | null
  area_name: AreaName | null
}

const PROSPECT_FIELDS = [
  { key: 'name', label: 'Full Name', required: true },
  { key: 'linkedin_url', label: 'LinkedIn URL', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'company', label: 'Company', required: false },
  { key: 'title', label: 'Job Title', required: false },
  { key: 'industry', label: 'Industry', required: false },
  { key: 'company_size', label: 'Company Size', required: false },
  { key: 'icp_score', label: 'ICP Score', required: false },
  { key: 'lead_temperature', label: 'Temperature (Cold/Warm/Hot)', required: false },
  { key: 'search_combo', label: 'Search Combo (A-F)', required: false },
  { key: 'scrape_date', label: 'Scrape Date', required: false },
  { key: 'market', label: 'Market / Country', required: false },
  { key: 'custom1', label: 'Custom 1 (msg1)', required: false },
  { key: 'custom2', label: 'Custom 2 (msg2)', required: false },
] as const

type ProspectFieldKey = typeof PROSPECT_FIELDS[number]['key']

function autoDetect(col: string): ProspectFieldKey | '' {
  const c = col.toLowerCase().replace(/[\s_-]/g, '')
  if (['name', 'fullname', 'leadname', 'contactname'].includes(c)) return 'name'
  if (['linkedin', 'linkedinurl', 'profileurl', 'linkedinprofile'].includes(c)) return 'linkedin_url'
  if (['email', 'emailaddress', 'mail'].includes(c)) return 'email'
  if (['company', 'companyname', 'organization', 'org'].includes(c)) return 'company'
  if (['title', 'jobtitle', 'position', 'role', 'jobrole'].includes(c)) return 'title'
  if (['industry', 'sector', 'vertical'].includes(c)) return 'industry'
  if (['companysize', 'size', 'employees', 'headcount'].includes(c)) return 'company_size'
  if (['icpscore', 'score', 'icp', 'icprating', 'icpfit'].includes(c)) return 'icp_score'
  if (['temperature', 'leadtemperature', 'temp', 'leadtemp'].includes(c)) return 'lead_temperature'
  if (['searchcombo', 'combo', 'comboused'].includes(c)) return 'search_combo'
  if (['scrapedate', 'date', 'scrapeddate', 'scrapedat'].includes(c)) return 'scrape_date'
  if (['custom1', 'mensaje1', 'message1', 'msg1'].includes(c)) return 'custom1'
  if (['custom2', 'mensaje2', 'message2', 'msg2'].includes(c)) return 'custom2'
  if (['market', 'country', 'region', 'location', 'geography', 'geo'].includes(c)) return 'market'
  return ''
}

interface ParsedRow {
  raw: Record<string, string>
  mapped: Record<string, string>
  status: 'new' | 'duplicate' | 'error' | 'blacklisted'
  duplicateType?: 'email' | 'linkedin' | 'both'
  duplicateName?: string
  error?: string
  skip: boolean
}

type Step = 1 | 2 | 3 | 4 | 5

const AREA_OPTIONS: { name: AreaName; label: string; disabled?: boolean; disabledReason?: string }[] =
  AREA_NAMES.map(name => ({ name, label: AREA_LABELS[name] }))

const AREA_COLORS: Record<AreaName, string> = {
  asia: '#6C63FF',
  latin_america: '#22C55E',
  europe: '#3B82F6',
  usa: '#C084FC',
}

const S: Record<string, React.CSSProperties> = {
  page: { padding: '24px 28px', color: 'var(--crm-text-primary)', maxWidth: 920, margin: '0 auto' },
  card: { backgroundColor: 'var(--crm-surface)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 28 },
  label: { fontSize: 12, color: 'var(--crm-text-secondary)', display: 'block', marginBottom: 6 },
  select: { backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', borderRadius: 6, color: 'var(--crm-text-primary)', padding: '7px 10px', fontSize: 13, width: '100%' },
  divider: { borderTop: '1px solid var(--crm-border)', margin: '20px 0' },
}

export function CSVImportWizard() {
  const { user, isAdmin } = useUser()
  const t = useTranslations('import')
  const tc = useTranslations('common')

  const [step, setStep] = useState<Step>(1)

  // Step 2: SDR selection (admin only — SDRs importing for themselves skip
  // this and keep self-assigning, same as before). The area is derived from
  // whichever SDR is picked, not chosen directly — a lead always needs an
  // owner, and today's "self-assign to the importing admin" default wasn't a
  // real destination for it to land on.
  const [sdrs, setSdrs] = useState<SdrOption[]>([])
  const [selectedSdrId, setSelectedSdrId] = useState<string>('')
  const [selectedArea, setSelectedArea] = useState<AreaName | null>(null)
  const [selectedAreaId, setSelectedAreaId] = useState<string>('')

  useEffect(() => {
    if (!isAdmin) return
    createClient()
      .from('users')
      .select('id, full_name, area_id, area:areas(name)')
      .eq('role', 'sdr')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        if (!data) return
        setSdrs((data as unknown as Array<{ id: string; full_name: string; area_id: string | null; area: { name: string } | null }>).map(s => ({
          id: s.id,
          full_name: s.full_name,
          area_id: s.area_id,
          area_name: (s.area?.name as AreaName) ?? null,
        })))
      })
  }, [isAdmin])

  function handleSdrSelect(sdrId: string) {
    const sdr = sdrs.find(s => s.id === sdrId)
    if (!sdr) return
    setSelectedSdrId(sdrId)
    setSelectedAreaId(sdr.area_id ?? '')
    setSelectedArea(sdr.area_name)
  }

  // Step 3: column mapping
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvData, setCsvData] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, ProspectFieldKey | ''>>({})

  // Step 4: dedup
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [checking, setChecking] = useState(false)

  // Step 5: import
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<{ imported: number; skipped: number; forced: number; errors: number; totalRows: number; skippedConstraint: number; blacklisted: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // True when the PUT request reached the server and got a response, but the
  // body couldn't be read — we genuinely don't know how many records made it
  // in, so `results` below must not be trusted/displayed as a normal outcome.
  const [importUnknown, setImportUnknown] = useState(false)

  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function parseCSV(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const headers = result.meta.fields ?? []
        setCsvHeaders(headers)
        setCsvData(result.data)
        const autoMap: Record<string, ProspectFieldKey | ''> = {}
        headers.forEach(h => { autoMap[h] = autoDetect(h) })
        setMapping(autoMap)

        if (!isAdmin && user?.area_id) {
          // SDR: resolve their area name for display, then skip to step 3
          const { data: areaData } = await createClient()
            .from('areas')
            .select('name')
            .eq('id', user.area_id)
            .single()
          setSelectedAreaId(user.area_id)
          if (areaData) setSelectedArea(areaData.name as AreaName)
          setStep(3)
        } else {
          setStep(2)
        }
      },
    })
  }

  function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) return
    if (file.size > 5 * 1024 * 1024) return
    parseCSV(file)
  }

  async function proceedToReview() {
    setChecking(true)

    // Collect emails and linkedins to check
    const emails: string[] = []
    const linkedins: string[] = []
    csvData.forEach(raw => {
      Object.entries(mapping).forEach(([csvCol, field]) => {
        if (field === 'email' && raw[csvCol]) emails.push(raw[csvCol].trim())
        if (field === 'linkedin_url' && raw[csvCol]) linkedins.push(raw[csvCol].trim())
      })
    })

    // Check duplicates + fetch org domain blacklist from the API
    let dupEmails: Record<string, string> = {}
    let dupLinkedins: Record<string, string> = {}
    let blacklistedDomains: string[] = []
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, linkedins }),
      })
      if (res.ok) {
        const data = await res.json()
        dupEmails = data.dupEmails ?? {}
        dupLinkedins = data.dupLinkedins ?? {}
        blacklistedDomains = data.blacklistedDomains ?? []
      }
    } catch {
      // If check fails, proceed without dedup (will still insert)
    }

    const parsed: ParsedRow[] = csvData.map(raw => {
      const mapped: Record<string, string> = {}
      Object.entries(mapping).forEach(([csvCol, field]) => {
        if (field && raw[csvCol] !== undefined) mapped[field] = raw[csvCol]
      })

      if (!mapped.name?.trim()) {
        return { raw, mapped, status: 'error', error: 'Missing name', skip: true }
      }

      // Domain blacklist check (email domain or linkedin domain)
      if (blacklistedDomains.length > 0) {
        const emailDomain = mapped.email?.trim().toLowerCase().split('@')[1] ?? ''
        const linkedinDomain = (() => {
          try { return new URL(mapped.linkedin_url?.trim() ?? '').hostname.replace('www.', '') } catch { return '' }
        })()
        const companyDomain = mapped.company?.trim().toLowerCase() ?? ''
        const isBlacklisted = blacklistedDomains.some(d =>
          (emailDomain && emailDomain.includes(d)) ||
          (linkedinDomain && linkedinDomain.includes(d)) ||
          (companyDomain && companyDomain.includes(d))
        )
        if (isBlacklisted) {
          return { raw, mapped, status: 'blacklisted', error: 'Domain blacklisted', skip: true }
        }
      }

      const email = mapped.email?.trim().toLowerCase()
      const linkedin = mapped.linkedin_url?.trim().toLowerCase()
      const emailMatch = email ? dupEmails[email] : null
      const linkedinMatch = linkedin ? dupLinkedins[linkedin] : null

      let status: ParsedRow['status'] = 'new'
      let duplicateType: ParsedRow['duplicateType']
      let duplicateName: string | undefined

      if (emailMatch && linkedinMatch) {
        status = 'duplicate'; duplicateType = 'both'; duplicateName = emailMatch
      } else if (emailMatch) {
        status = 'duplicate'; duplicateType = 'email'; duplicateName = emailMatch
      } else if (linkedinMatch) {
        status = 'duplicate'; duplicateType = 'linkedin'; duplicateName = linkedinMatch
      }

      return { raw, mapped, status, duplicateType, duplicateName, skip: status === 'duplicate' }
    })

    setRows(parsed)
    setChecking(false)

    const hasDuplicates = parsed.some(r => r.status === 'duplicate')
    if (!hasDuplicates) {
      await runImportWithRows(parsed)
    } else {
      setStep(4)
    }
  }

  function toggleSkip(index: number) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, skip: !r.skip } : r))
  }

  function skipAllDuplicates() {
    setRows(prev => prev.map(r => r.status === 'duplicate' ? { ...r, skip: true } : r))
  }

  function forceAllDuplicates() {
    setRows(prev => prev.map(r => r.status === 'duplicate' ? { ...r, skip: false } : r))
  }

  async function runImportWithRows(targetRows: ParsedRow[]) {
    setImporting(true)
    let imported = 0, skipped = 0, forced = 0, skippedConstraint = 0
    let statusUnknown = false

    const blacklistedRows = targetRows.filter(r => r.status === 'blacklisted')
    const toInsert = targetRows.filter(r => r.status !== 'error' && r.status !== 'blacklisted' && !r.skip)
    const errorRows = targetRows.filter(r => r.status === 'error')
    skipped = targetRows.filter(r => r.skip && r.status !== 'error' && r.status !== 'blacklisted').length

    const records = toInsert.map(r => {
      if (r.status === 'duplicate') forced++
      const m = r.mapped
      return {
        name: m.name?.trim(),
        linkedin_url: m.linkedin_url?.trim() || null,
        email: m.email?.trim() || null,
        company: m.company?.trim() || null,
        title: m.title?.trim() || null,
        industry: m.industry?.trim() || null,
        company_size: m.company_size?.trim() || null,
        icp_score: m.icp_score ? parseFloat(m.icp_score) : null,
        lead_temperature: LEAD_TEMPERATURES.includes(m.lead_temperature as typeof LEAD_TEMPERATURES[number]) ? m.lead_temperature : null,
        search_combo: SEARCH_COMBOS.includes(m.search_combo as typeof SEARCH_COMBOS[number]) ? m.search_combo : null,
        scrape_date: m.scrape_date?.trim() || null,
        custom1: m.custom1?.trim() || null,
        custom2: m.custom2?.trim() || null,
        market: m.market?.trim() || null,
        outreach_status: 'new' as const,
        area_id: selectedAreaId,
        source: 'csv_import' as const,
        created_by: user?.id ?? null,
        // Admins assign to the SDR picked in step 2; an SDR importing for
        // themselves (no picker shown) still self-assigns as before.
        assigned_to: selectedSdrId || user?.id || null,
        flag_tomorrow: false,
      }
    })

    if (records.length > 0) {
      let res: Response | null = null
      try {
        res = await fetch('/api/import', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records }),
        })
      } catch (e) {
        // The request never got a response at all — safe to assume nothing
        // was inserted server-side.
        setImportError(e instanceof Error ? e.message : 'Error de red')
        skipped += records.length
      }

      if (res) {
        let data: { imported?: number; skippedConstraint?: number; errors?: string[]; error?: string } | null = null
        try {
          data = await res.json()
        } catch {
          // We got a response but couldn't read its body. The insert may
          // already have completed server-side before the response got cut
          // off (this is exactly what happened in a real incident: 4 leads
          // were inserted, the client saw this same parse failure, and a
          // blind retry with the same CSV made them look like a dedup bug
          // the next time around). Never guess at counts here.
          statusUnknown = true
          setImportError('Import status unknown — check Leads before retrying.')
        }

        if (!statusUnknown && data) {
          if (res.ok) {
            imported = data.imported ?? 0
            skippedConstraint = data.skippedConstraint ?? 0
            if (data.errors?.length) setImportError(data.errors.join(', '))
          } else {
            setImportError(data.error ?? `HTTP ${res.status}`)
            skipped += records.length
          }
        }
      }
    }

    await logAuditEvent({
      event_type: 'csv_import',
      metadata: {
        imported, skipped, forced, errors: errorRows.length, total: targetRows.length, area: selectedArea,
        assigned_sdr: sdrs.find(s => s.id === selectedSdrId)?.full_name ?? null,
        status_unknown: statusUnknown,
      },
    })

    setImportUnknown(statusUnknown)
    setResults({ imported, skipped, forced, errors: errorRows.length, totalRows: targetRows.length, skippedConstraint, blacklisted: blacklistedRows.length })
    setImporting(false)
    setStep(5)
  }

  function runImport() {
    return runImportWithRows(rows)
  }

  function resetWizard() {
    setStep(1)
    // Keep the logged-in SDR's own area pre-loaded — it never changes
    if (isAdmin) {
      setSelectedSdrId('')
      setSelectedArea(null)
      setSelectedAreaId('')
    }
    setCsvHeaders([])
    setCsvData([])
    setMapping({})
    setRows([])
    setResults(null)
    setImportError(null)
    setImportUnknown(false)
  }

  const newCount = rows.filter(r => r.status === 'new').length
  const dupCount = rows.filter(r => r.status === 'duplicate').length
  const errorCount = rows.filter(r => r.status === 'error').length
  const blacklistedCount = rows.filter(r => r.status === 'blacklisted').length
  const willImport = rows.filter(r => !r.skip && r.status !== 'error' && r.status !== 'blacklisted').length

  // SDRs skip step 2 (area), so remap display steps
  const adminSteps = [
    { s: 1 as Step, label: t('step1') },
    { s: 2 as Step, label: 'Area' },
    { s: 3 as Step, label: t('step2') },
    { s: 4 as Step, label: t('step3') },
    { s: 5 as Step, label: t('step4') },
  ]
  const sdrSteps = [
    { s: 1 as Step, label: t('step1') },
    { s: 3 as Step, label: t('step2') },
    { s: 4 as Step, label: t('step3') },
    { s: 5 as Step, label: t('step4') },
  ]
  const displaySteps = isAdmin ? adminSteps : sdrSteps

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('title')}</h1>
      </div>

      {/* Step indicator — scrolls horizontally instead of wrapping so the
          connected step/line look survives narrow phones */}
      <div style={{ overflowX: 'auto', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, width: 'max-content' }}>
        {displaySteps.map(({ s, label }, i) => {
          const done = step > s
          const active = step === s
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  backgroundColor: done ? '#22C55E' : active ? 'var(--crm-accent)' : 'var(--crm-border)',
                  color: done || active ? '#FFF' : 'var(--crm-text-muted)',
                  transition: 'all 0.2s',
                }}>
                  {done ? '✓' : s}
                </div>
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--crm-text-primary)' : 'var(--crm-text-muted)' }}>
                  {label}
                </span>
              </div>
              {i < displaySteps.length - 1 && <div style={{ width: 32, height: 1, backgroundColor: 'var(--crm-border)', margin: '0 10px' }} />}
            </div>
          )
        })}
      </div>
      </div>

      {/* STEP 1: Upload */}
      {step === 1 && (
        <div
          style={{
            ...S.card,
            border: `2px dashed ${dragOver ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
            backgroundColor: dragOver ? '#6C63FF08' : 'var(--crm-surface)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: 240, cursor: 'pointer', transition: 'all 0.2s',
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        >
          <UploadCloud size={44} color={dragOver ? 'var(--crm-accent)' : 'var(--crm-text-muted)'} />
          <p style={{ marginTop: 14, fontSize: 16, color: 'var(--crm-text-primary)', fontWeight: 500 }}>{t('dropzone')}</p>
          <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginTop: 6 }}>{t('csvOnly')} · {t('maxSize')}</p>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {/* STEP 2: Area selection */}
      {step === 2 && (
        <div style={S.card}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Which SDR should these leads go to?</h2>
          <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', marginBottom: 28 }}>
            All {csvData.length} rows in the CSV will be assigned to this SDR, in their area.
          </p>

          {sdrs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--crm-text-muted)', marginBottom: 32 }}>No active SDRs found. Add one in Settings → Users first.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
              {sdrs.map(sdr => {
                const isSelected = selectedSdrId === sdr.id
                const color = sdr.area_name ? AREA_COLORS[sdr.area_name] : 'var(--crm-text-muted)'
                return (
                  <button
                    key={sdr.id}
                    onClick={() => handleSdrSelect(sdr.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                      border: `2px solid ${isSelected ? color : 'var(--crm-border)'}`,
                      backgroundColor: isSelected ? color + '18' : 'var(--crm-surface-raised)',
                      transition: 'all 0.15s', textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', border: `2px solid ${isSelected ? color : '#3A3A4A'}`,
                      backgroundColor: isSelected ? color : 'transparent', transition: 'all 0.15s', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#FFF' }} />}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: isSelected ? 700 : 500, color: isSelected ? color : 'var(--crm-text-primary)', flex: 1 }}>
                      {sdr.full_name}
                    </span>
                    {sdr.area_name && (
                      <span style={{ fontSize: 11, color: 'var(--crm-text-muted)' }}>{AREA_LABELS[sdr.area_name]}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10 }}>
            <Button onClick={() => setStep(1)} style={{ backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>
              <ChevronLeft size={14} /> {tc('back')}
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={!selectedSdrId || !selectedAreaId}
              style={{ backgroundColor: selectedSdrId ? 'var(--crm-accent)' : 'var(--crm-border)', color: '#FFF' }}
            >
              {tc('next_step')} <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Column mapping */}
      {step === 3 && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t('columnMapping')}</h2>
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)' }}>
                {csvData.length} rows · {csvHeaders.length} columns · Area:{' '}
                <span style={{ color: AREA_COLORS[selectedArea!], fontWeight: 600 }}>
                  {AREA_OPTIONS.find(a => a.name === selectedArea)?.label}
                </span>
                {selectedSdrId && (
                  <> · SDR: <span style={{ color: 'var(--crm-text-secondary)', fontWeight: 600 }}>{sdrs.find(s => s.id === selectedSdrId)?.full_name}</span></>
                )}
              </p>
            </div>
          </div>

          {selectedSdrId && (Object.values(mapping).includes('custom1') || Object.values(mapping).includes('custom2')) && (
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40', borderRadius: 8, marginBottom: 20 }}>
              <AlertTriangle size={15} color="#F59E0B" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12.5, color: 'var(--crm-text-secondary)', lineHeight: 1.5, margin: 0 }}>
                These leads already have messages generated for <strong style={{ color: 'var(--crm-text-primary)' }}>{sdrs.find(s => s.id === selectedSdrId)?.full_name}</strong> — make sure this matches the SDR you&apos;re assigning to. The message content was written with a specific sender in mind and won&apos;t be regenerated.
              </p>
            </div>
          )}

          <div className="crm-grid-1-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
            {csvHeaders.map(col => (
              <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, padding: '7px 10px', backgroundColor: 'var(--crm-background)', border: '1px solid var(--crm-border)', borderRadius: 6, fontSize: 13, color: 'var(--crm-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {col}
                </div>
                <span style={{ color: 'var(--crm-text-muted)', fontSize: 12 }}>→</span>
                <select
                  value={mapping[col] ?? ''}
                  onChange={e => setMapping(prev => ({ ...prev, [col]: e.target.value as ProspectFieldKey | '' }))}
                  style={{ ...S.select, flex: 1 }}
                >
                  <option value="">— skip —</option>
                  {PROSPECT_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.label}{f.required ? ' *' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview */}
          <div style={S.divider} />
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-text-secondary)', marginBottom: 12 }}>{t('preview')}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {csvHeaders.slice(0, 6).map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--crm-border)' }}>
                      {mapping[h]
                        ? <span style={{ color: 'var(--crm-text-secondary)' }}>{mapping[h]}</span>
                        : <span style={{ color: '#3A3A4A', textDecoration: 'line-through' }}>{h}</span>
                      }
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvData.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--crm-surface-raised)' }}>
                    {csvHeaders.slice(0, 6).map(h => (
                      <td key={h} style={{ padding: '6px 8px', color: mapping[h] ? 'var(--crm-text-primary)' : '#3A3A4A', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row[h] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, marginTop: 24 }}>
            <Button onClick={() => setStep(isAdmin ? 2 : 1)} style={{ backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>
              <ChevronLeft size={14} /> {tc('back')}
            </Button>
            <Button
              onClick={proceedToReview}
              disabled={checking || !Object.values(mapping).includes('name')}
              style={{ backgroundColor: 'var(--crm-accent)', color: '#FFF' }}
            >
              {checking ? t('checking') : t('proceedToReview')} <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Review duplicates only */}
      {step === 4 && (
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <AlertTriangle size={18} color="#F59E0B" />
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>{t('duplicateCheck')}</h2>
              <p style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginTop: 2 }}>
                {dupCount} {t('duplicates')} · {newCount} {t('new')} {t('willImport').toLowerCase()}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ padding: '8px 16px', backgroundColor: '#22C55E15', border: '1px solid #22C55E30', borderRadius: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#22C55E' }}>{newCount}</span>
              <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', display: 'block' }}>{t('new')} ✓</span>
            </div>
            <div style={{ padding: '8px 16px', backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40', borderRadius: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#F59E0B' }}>{dupCount}</span>
              <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', display: 'block' }}>{t('duplicates')}</span>
            </div>
            {errorCount > 0 && (
              <div style={{ padding: '8px 16px', backgroundColor: '#EF444415', border: '1px solid #EF444430', borderRadius: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: '#EF4444' }}>{errorCount}</span>
                <span style={{ fontSize: 12, color: 'var(--crm-text-secondary)', display: 'block' }}>{t('errors')}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={skipAllDuplicates} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--crm-border)', backgroundColor: 'transparent', color: 'var(--crm-text-secondary)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <SkipForward size={11} /> {t('skipAll')}
            </button>
            <button onClick={forceAllDuplicates} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #F59E0B40', backgroundColor: '#F59E0B10', color: '#F59E0B', fontSize: 12, cursor: 'pointer' }}>
              {t('forceImport')}
            </button>
          </div>

          <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid var(--crm-border)', borderRadius: 8 }}>
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--crm-surface-raised)' }}>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--crm-text-muted)', fontWeight: 500, fontSize: 11 }}>CSV Record</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--crm-text-muted)', fontWeight: 500, fontSize: 11 }}>Match</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--crm-text-muted)', fontWeight: 500, fontSize: 11 }}>Already exists as</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--crm-text-muted)', fontWeight: 500, fontSize: 11 }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (row.status !== 'duplicate') return null
                  const willForce = !row.skip
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--crm-surface-raised)', opacity: row.skip ? 0.5 : 1, backgroundColor: willForce ? '#F59E0B08' : 'transparent' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: row.skip ? 'var(--crm-text-muted)' : 'var(--crm-text-primary)' }}>{row.mapped.name || '—'}</div>
                        <div style={{ fontSize: 11, color: '#3A3A4A', marginTop: 2 }}>{row.mapped.company || ''}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, backgroundColor: '#F59E0B25', color: '#F59E0B', textTransform: 'uppercase' }}>
                          {row.duplicateType}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--crm-text-secondary)', fontSize: 12 }}>
                        {row.duplicateName || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {row.skip ? (
                          <button
                            onClick={() => toggleSkip(i)}
                            style={{ padding: '4px 14px', borderRadius: 5, border: '1px solid #F59E0B40', cursor: 'pointer', fontSize: 11, fontWeight: 600, backgroundColor: '#F59E0B10', color: '#F59E0B' }}
                          >
                            {t('forceImport')}
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleSkip(i)}
                            style={{ padding: '4px 14px', borderRadius: 5, border: '1px solid #EF444440', cursor: 'pointer', fontSize: 11, fontWeight: 600, backgroundColor: '#EF444410', color: '#EF4444' }}
                          >
                            {t('skip')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 11, color: 'var(--crm-text-muted)', marginTop: 10 }}>
            {rows.filter(r => r.status === 'duplicate' && r.skip).length} {t('skipped').toLowerCase()} · {rows.filter(r => r.status === 'duplicate' && !r.skip).length} will be imported anyway
            {blacklistedCount > 0 && ` · ${blacklistedCount} blocked by blacklist`}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, marginTop: 16 }}>
            <Button onClick={() => setStep(3)} style={{ backgroundColor: 'var(--crm-border)', color: 'var(--crm-text-primary)' }}>
              <ChevronLeft size={14} /> {tc('back')}
            </Button>
            <Button onClick={runImport} disabled={importing || willImport === 0} style={{ backgroundColor: 'var(--crm-accent)', color: '#FFF' }}>
              {importing ? t('importing') : `${t('startImport')} (${willImport})`}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 5a: Results — unknown outcome (response body unreadable, insert
          may already have happened server-side). Deliberately does NOT show
          the normal imported/skipped counters below — those would read as
          "0 imported", actively contradicting the fact that we don't know. */}
      {step === 5 && results && importUnknown && (
        <div style={{ ...S.card, textAlign: 'center' }}>
          <AlertTriangle size={52} color="#F59E0B" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Import status unknown</h2>
          <div style={{ padding: '12px 16px', backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40', borderRadius: 8, marginBottom: 20, fontSize: 13, color: 'var(--crm-text-secondary)', textAlign: 'left', lineHeight: 1.6 }}>
            {importError} The request reached the server but the response didn&apos;t come back properly, so we can&apos;t confirm whether these {results.totalRows} rows were saved — please check Leads before re-uploading this CSV.
          </div>
          <Button onClick={resetWizard} style={{ backgroundColor: 'var(--crm-accent)', color: '#FFF' }}>
            {t('importAnother')}
          </Button>
        </div>
      )}

      {/* STEP 5b: Results — normal outcome */}
      {step === 5 && results && !importUnknown && (
        <div style={{ ...S.card, textAlign: 'center' }}>
          <CheckCircle size={52} color={results.imported > 0 ? '#22C55E' : 'var(--crm-text-muted)'} style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('importComplete')}</h2>

          {importError && (
            <div style={{ padding: '10px 14px', backgroundColor: '#EF444415', border: '1px solid #EF444440', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#EF4444', textAlign: 'left' }}>
              <strong>Error:</strong> {importError}
            </div>
          )}

          {selectedArea && (
            <div style={{ display: 'inline-block', marginBottom: 20, padding: '4px 14px', borderRadius: 20, backgroundColor: AREA_COLORS[selectedArea] + '20', color: AREA_COLORS[selectedArea], fontSize: 13, fontWeight: 600, border: `1px solid ${AREA_COLORS[selectedArea]}40` }}>
              {AREA_OPTIONS.find(a => a.name === selectedArea)?.label}
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--crm-text-muted)', marginBottom: 8 }}>{results.totalRows} rows in the CSV</div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, margin: '20px 0', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: '#22C55E' }}>{results.imported}</div>
              <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>{t('imported')}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: '#F59E0B' }}>{results.skipped}</div>
              <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>Duplicates skipped</div>
            </div>
            {results.blacklisted > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: '#EF4444' }}>{results.blacklisted}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>Blocked by blacklist</div>
              </div>
            )}
            {results.skippedConstraint > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--crm-text-muted)' }}>{results.skippedConstraint}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>Already existed (global)</div>
              </div>
            )}
            {results.errors > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: '#EF4444' }}>{results.errors}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>No name (error)</div>
              </div>
            )}
            {results.forced > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--crm-accent)' }}>{results.forced}</div>
                <div style={{ fontSize: 12, color: 'var(--crm-text-secondary)' }}>Forced duplicates</div>
              </div>
            )}
          </div>

          <Button onClick={resetWizard} style={{ backgroundColor: 'var(--crm-accent)', color: '#FFF' }}>
            {t('importAnother')}
          </Button>
        </div>
      )}
    </div>
  )
}
