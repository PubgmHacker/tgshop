import ru from '../locales/ru.json' with { type: 'json' }
import en from '../locales/en.json' with { type: 'json' }

export type Locale = 'ru' | 'en'

const DICTS: Record<Locale, unknown> = { ru, en }

export function resolveLocale(languageCode: string | null | undefined): Locale {
  if (languageCode && languageCode.toLowerCase().startsWith('ru')) return 'ru'
  return 'en'
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

/**
 * Translates `key` (dot-path into the locale JSON) for the given locale,
 * interpolating `{placeholder}` tokens from `vars`.
 */
export function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const dict = DICTS[locale]
  const raw = getPath(dict, key)
  const template = typeof raw === 'string' ? raw : key
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = vars[token]
    return value === undefined ? `{${token}}` : String(value)
  })
}

/** Creates a translator bound to a single locale, for convenience. */
export function createTranslator(locale: Locale) {
  return (key: string, vars: Record<string, string | number> = {}): string => t(locale, key, vars)
}
