'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, type DictionaryKey, type Locale, dictionaries } from './dictionaries'

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: DictionaryKey, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const nav = window.navigator.language?.toLowerCase() ?? ''
  return nav.startsWith('ru') ? 'ru' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale())

  const t = useCallback(
    (key: DictionaryKey, vars?: Record<string, string | number>) => {
      const dict = dictionaries[locale] as Record<string, string>
      const template = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key
      return interpolate(template, vars)
    },
    [locale]
  )

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
