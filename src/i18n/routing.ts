import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['zh', 'en', 'vi', 'es'],
  defaultLocale: 'zh',
  localePrefix: 'always'
})
