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
  try {
    const stored = window.localStorage.getItem('tgshop.admin.locale')
    if (stored === 'ru' || stored === 'en') return stored
  } catch {
    // Private mode / blocked storage: use the browser language below.
  }
  const nav = window.navigator.language?.toLowerCase() ?? ''
  return nav.startsWith('ru') ? 'ru' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale())
  const changeLocale = useCallback((next: Locale) => {
    setLocale(next)
    try {
      window.localStorage.setItem('tgshop.admin.locale', next)
    } catch {
      // The selection still applies for the current session.
    }
  }, [])

  const t = useCallback(
    (key: DictionaryKey, vars?: Record<string, string | number>) => {
      const dict = dictionaries[locale] as Record<string, string>
      const template = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key
      return interpolate(template, vars)
    },
    [locale]
  )

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale: changeLocale, t }),
    [locale, changeLocale, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
