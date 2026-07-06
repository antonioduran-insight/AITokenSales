'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const LOCALES = [
  { code: 'zh', label: '繁中' },
  { code: 'en', label: 'EN' },
  { code: 'vi', label: 'VI' },
  { code: 'es', label: 'ES' },
]

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  function switchLocale(newLocale: string) {
    router.replace(pathname, { locale: newLocale })
    setOpen(false)
  }

  const current = LOCALES.find(l => l.code === locale)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid var(--crm-border)',
          backgroundColor: 'var(--crm-surface-raised)',
          color: 'var(--crm-text-secondary)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {current?.label}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            backgroundColor: 'var(--crm-surface-raised)',
            border: '1px solid var(--crm-border)',
            borderRadius: 8,
            overflow: 'hidden',
            zIndex: 50,
            minWidth: 80,
          }}
        >
          {LOCALES.map(l => (
            <button
              key={l.code}
              onClick={() => switchLocale(l.code)}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                textAlign: 'left',
                fontSize: 13,
                cursor: 'pointer',
                backgroundColor: l.code === locale ? 'var(--crm-border)' : 'transparent',
                color: l.code === locale ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)',
                border: 'none',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
