'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/utils/audit'
import { getCurrentOrganizationId } from '@/lib/utils/organization'
import { checkDuplicate } from '@/lib/utils/dedup'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useUser } from '@/contexts/UserContext'
import { AlertTriangle } from 'lucide-react'
import type { Area, User, OutreachStatus, LeadTemperature, SearchCombo } from '@/lib/types'
import { OUTREACH_STATUSES, LEAD_TEMPERATURES, SEARCH_COMBOS } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  defaultAreaId?: string
}

const SELECT_STYLE = {
  width: '100%', padding: '8px 10px',
  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)',
  borderRadius: 6, color: 'var(--crm-text-primary)', fontSize: 13,
}

const INPUT_STYLE = {
  backgroundColor: 'var(--crm-surface-raised)', border: '1px solid var(--crm-border)', color: 'var(--crm-text-primary)', fontSize: 13,
}

function FormField({ label, children, warn }: { label: string; children: React.ReactNode; warn?: string }) {
  return (
    <div>
      <Label style={{ color: 'var(--crm-text-secondary)', fontSize: 12, marginBottom: 4, display: 'block' }}>{label}</Label>
      {children}
      {warn && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, color: '#F59E0B', fontSize: 12 }}>
          <AlertTriangle size={12} />
          {warn}
        </div>
      )}
    </div>
  )
}

export function ProspectForm({ open, onClose, onCreated, defaultAreaId }: Props) {
  const t = useTranslations()
  const { user, isAdmin } = useUser()

  const [areas, setAreas] = useState<Area[]>([])
  const [sdrs, setSdrs] = useState<User[]>([])
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    linkedin_url: '',
    email: '',
    company: '',
    title: '',
    industry: '',
    company_size: '',
    icp_score: '',
    lead_temperature: '' as LeadTemperature | '',
    search_combo: '' as SearchCombo | '',
    scrape_date: '',
    custom1: '',
    custom2: '',
    outreach_status: 'new' as OutreachStatus,
    market: '',
    area_id: defaultAreaId ?? '',
    assigned_to: '',
    flag_tomorrow: false,
  })

  const [dupWarn, setDupWarn] = useState<{ email?: string; linkedin?: string }>({})

  useEffect(() => {
    if (!open) return

    const supabase = createClient()
    supabase.from('areas').select('*').then(({ data }) => {
      if (data) setAreas(data as Area[])
    })

    if (isAdmin) {
      supabase.from('users').select('*').eq('role', 'sdr').eq('is_active', true).then(({ data }) => {
        if (data) setSdrs(data as User[])
      })
    }

    // Pre-assign SDR to themselves
    if (!isAdmin && user) {
      setForm(f => ({ ...f, assigned_to: user.id, area_id: user.area_id ?? defaultAreaId ?? '' }))
    }
  }, [open, isAdmin, user, defaultAreaId])

  // Update default area when prop changes
  useEffect(() => {
    if (defaultAreaId) setForm(f => ({ ...f, area_id: defaultAreaId }))
  }, [defaultAreaId])

  function set(field: string, value: unknown) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleEmailBlur() {
    if (!form.email) return
    const result = await checkDuplicate(form.email, null)
    setDupWarn(w => ({ ...w, email: result.isDuplicate ? t('prospect.duplicateEmailWarning') : undefined }))
  }

  async function handleLinkedInBlur() {
    if (!form.linkedin_url) return
    const result = await checkDuplicate(null, form.linkedin_url)
    setDupWarn(w => ({ ...w, linkedin: result.isDuplicate ? t('prospect.duplicateLinkedInWarning') : undefined }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.area_id) return
    setSaving(true)

    const supabase = createClient()
    const { data: authUser } = await supabase.auth.getUser()
    const orgId = await getCurrentOrganizationId()

    const payload = {
      name: form.name,
      linkedin_url: form.linkedin_url || null,
      email: form.email || null,
      company: form.company || null,
      title: form.title || null,
      industry: form.industry || null,
      company_size: form.company_size || null,
      icp_score: form.icp_score ? Number(form.icp_score) : null,
      lead_temperature: form.lead_temperature || null,
      search_combo: form.search_combo || null,
      scrape_date: form.scrape_date || null,
      custom1: form.custom1 || null,
      custom2: form.custom2 || null,
      outreach_status: form.outreach_status,
      market: form.market || null,
      area_id: form.area_id,
      assigned_to: form.assigned_to || null,
      flag_tomorrow: form.flag_tomorrow,
      source: 'manual' as const,
      created_by: authUser.user?.id ?? null,
      organization_id: orgId,
    }

    const { data, error } = await supabase.from('prospects').insert(payload).select().single()

    if (!error && data) {
      await logAuditEvent({
        event_type: 'prospect_created',
        prospect_id: data.id,
        prospect_name: form.name,
        metadata: { source: 'manual', area_id: form.area_id },
      })
      onCreated()
      // Reset form
      setForm({
        name: '', linkedin_url: '', email: '', company: '', title: '',
        industry: '', company_size: '', icp_score: '', lead_temperature: '',
        search_combo: '', scrape_date: '', custom1: '', custom2: '',
        outreach_status: 'new', market: '', area_id: defaultAreaId ?? '', assigned_to: '', flag_tomorrow: false,
      })
      setDupWarn({})
    }

    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        style={{
          backgroundColor: 'var(--crm-surface)',
          border: '1px solid var(--crm-border)',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          color: 'var(--crm-text-primary)',
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--crm-text-primary)' }}>{t('prospect.new')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          {/* Row 1: name */}
          <FormField label={`${t('prospect.name')} *`}>
            <Input required value={form.name} onChange={e => set('name', e.target.value)} style={INPUT_STYLE} />
          </FormField>

          {/* Row 2: company + title */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={t('prospect.company')}>
              <Input value={form.company} onChange={e => set('company', e.target.value)} style={INPUT_STYLE} />
            </FormField>
            <FormField label={t('prospect.title')}>
              <Input value={form.title} onChange={e => set('title', e.target.value)} style={INPUT_STYLE} />
            </FormField>
          </div>

          {/* Row 3: linkedin + email */}
          <FormField label={t('prospect.linkedinUrl')} warn={dupWarn.linkedin}>
            <Input
              value={form.linkedin_url}
              onChange={e => set('linkedin_url', e.target.value)}
              onBlur={handleLinkedInBlur}
              placeholder="https://linkedin.com/in/..."
              style={INPUT_STYLE}
            />
          </FormField>

          <FormField label={t('prospect.email')} warn={dupWarn.email}>
            <Input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              onBlur={handleEmailBlur}
              style={INPUT_STYLE}
            />
          </FormField>

          {/* Row 4: industry + company_size */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={t('prospect.industry')}>
              <Input value={form.industry} onChange={e => set('industry', e.target.value)} style={INPUT_STYLE} />
            </FormField>
            <FormField label={t('prospect.companySize')}>
              <Input value={form.company_size} onChange={e => set('company_size', e.target.value)} style={INPUT_STYLE} />
            </FormField>
          </div>

          {/* Row 5: area + status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={`${t('prospect.area')} *`}>
              <select
                required
                value={form.area_id}
                onChange={e => set('area_id', e.target.value)}
                style={SELECT_STYLE}
                disabled={!isAdmin}
              >
                <option value="">{t('common.select')}</option>
                {areas.filter(a => a.is_active).map(a => (
                  <option key={a.id} value={a.id}>{a.label_en}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('prospect.outreachStatus')}>
              <select value={form.outreach_status} onChange={e => set('outreach_status', e.target.value)} style={SELECT_STYLE}>
                {OUTREACH_STATUSES.map(s => (
                  <option key={s} value={s}>{t(`outreachStatus.${s}`)}</option>
                ))}
              </select>
            </FormField>
          </div>

          {/* Row 6: temperature + ICP */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={t('prospect.leadTemperature')}>
              <select value={form.lead_temperature} onChange={e => set('lead_temperature', e.target.value)} style={SELECT_STYLE}>
                <option value="">{t('common.none')}</option>
                {LEAD_TEMPERATURES.map(temp => (
                  <option key={temp} value={temp}>{t(`temperature.${temp}`)}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('prospect.icpScore')}>
              <Input type="number" min={0} max={100} value={form.icp_score} onChange={e => set('icp_score', e.target.value)} style={INPUT_STYLE} />
            </FormField>
          </div>

          {/* Row 7: assigned_to (admin) */}
          {isAdmin && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label={t('prospect.assignedTo')}>
                <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={SELECT_STYLE}>
                  <option value="">{t('common.none')}</option>
                  {sdrs.map(sdr => (
                    <option key={sdr.id} value={sdr.id}>{sdr.full_name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label={t('prospect.market')}>
                <Input value={form.market} onChange={e => set('market', e.target.value)} style={INPUT_STYLE} />
              </FormField>
            </div>
          )}

          {/* Row 8: search_combo + scrape_date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label={t('prospect.searchCombo')}>
              <select value={form.search_combo} onChange={e => set('search_combo', e.target.value)} style={SELECT_STYLE}>
                <option value="">{t('common.none')}</option>
                {SEARCH_COMBOS.map(c => (
                  <option key={c} value={c}>{t(`searchCombo.${c}`)}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('prospect.scrapeDate')}>
              <Input type="date" value={form.scrape_date} onChange={e => set('scrape_date', e.target.value)} style={INPUT_STYLE} />
            </FormField>
          </div>

          {/* Custom 1 / 2 */}
          {(['custom1', 'custom2'] as const).map(field => (
            <FormField key={field} label={t(`prospect.${field}`)}>
              <textarea
                value={form[field]}
                onChange={e => set(field, e.target.value)}
                rows={3}
                style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
            </FormField>
          ))}

          {/* Flag tomorrow */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.flag_tomorrow}
              onChange={e => set('flag_tomorrow', e.target.checked)}
              style={{ accentColor: 'var(--crm-accent)', width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, color: 'var(--crm-text-secondary)' }}>{t('prospect.flagTomorrow')}</span>
          </label>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid var(--crm-border)' }}>
            <Button type="button" variant="outline" onClick={onClose}
              style={{ backgroundColor: 'transparent', border: '1px solid var(--crm-border)', color: 'var(--crm-text-secondary)' }}>
              {t('prospect.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !form.name || !form.area_id}
              style={{ backgroundColor: 'var(--crm-accent)', color: 'var(--crm-text-primary)' }}>
              {saving ? t('prospect.saving') : t('prospect.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
