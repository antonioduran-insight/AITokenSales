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
          border: '1px solid #2A2A3A',
          backgroundColor: '#1C1C27',
          color: '#8B8BA0',
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
            backgroundColor: '#1C1C27',
            border: '1px solid #2A2A3A',
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
                backgroundColor: l.code === locale ? '#2A2A3A' : 'transparent',
                color: l.code === locale ? '#F0F0F5' : '#8B8BA0',
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
