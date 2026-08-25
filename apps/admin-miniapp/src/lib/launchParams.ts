const INIT_DATA_STORAGE_KEY = 'tgshop.initData'

// Telegram delivers initData in the URL fragment (#tgWebAppData=...), but by
// the time our code runs the fragment can already be gone: the SDK's own init
// strips it, iOS WKWebView loses it on in-app reloads, and anything calling
// history.replaceState wipes it silently. So the probe tries every place the
// value can survive, in freshness order, and re-persists whatever it finds so
// the next in-app navigation or reload still authenticates.

export type InitDataSource = 'hash' | 'webview' | 'navigation' | 'session' | 'none'

export interface InitDataProbe {
  initData: string | null
  source: InitDataSource
}

function extractFromParams(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  try {
    const value = new URLSearchParams(trimmed).get('tgWebAppData')
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function fromWindowLocation(): string | null {
  return extractFromParams(window.location.hash) ?? extractFromParams(window.location.search)
}

/** The object the official telegram-web-app.js script injects, when present. */
function fromWebAppObject(): string | null {
  const telegram = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram
  const initData = telegram?.WebApp?.initData
  return initData && initData.length > 0 ? initData : null
}

/**
 * The performance navigation entry keeps the document URL Telegram originally
 * opened — fragment included — even after the visible URL was rewritten.
 */
function fromNavigationEntry(): string | null {
  try {
    const [entry] = performance.getEntriesByType('navigation')
    const url = entry?.name
    if (!url) return null
    const hashIndex = url.indexOf('#')
    if (hashIndex === -1) return null
    return extractFromParams(url.slice(hashIndex))
  } catch {
    return null
  }
}

function fromSessionStorage(): string | null {
  try {
    return sessionStorage.getItem(INIT_DATA_STORAGE_KEY)
  } catch {
    return null
  }
}

export function probeInitData(): InitDataProbe {
  if (typeof window === 'undefined') return { initData: null, source: 'none' }

  const candidates: Array<[InitDataSource, string | null]> = [
    ['hash', fromWindowLocation()],
    ['webview', fromWebAppObject()],
    ['navigation', fromNavigationEntry()],
    ['session', fromSessionStorage()]
  ]

  for (const [source, initData] of candidates) {
    if (!initData) continue
    if (source !== 'session') {
      try {
        sessionStorage.setItem(INIT_DATA_STORAGE_KEY, initData)
      } catch {
        // private mode / quota — ignore
      }
    }
    return { initData, source }
  }

  return { initData: null, source: 'none' }
}

export function readInitDataFromLocation(): string | null {
  return probeInitData().initData
}
