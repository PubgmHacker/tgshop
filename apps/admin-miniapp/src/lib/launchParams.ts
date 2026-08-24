const INIT_DATA_STORAGE_KEY = 'tgshop.initData'

/**
 * Read Telegram WebApp initData from the launch URL.
 * Desktop/dev often pass it in the hash as `tgWebAppData=...` (SDK launch params).
 */
export function readInitDataFromLocation(): string | null {
  if (typeof window === 'undefined') return null

  const fromQuery = (raw: string): string | null => {
    if (!raw) return null
    const params = new URLSearchParams(raw)
    return params.get('tgWebAppData')
  }

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const search = window.location.search.startsWith('?')
    ? window.location.search.slice(1)
    : window.location.search

  const fromUrl = fromQuery(hash) ?? fromQuery(search)
  if (fromUrl) {
    try {
      sessionStorage.setItem(INIT_DATA_STORAGE_KEY, fromUrl)
    } catch {
      // private mode / quota — ignore
    }
    return fromUrl
  }

  try {
    return sessionStorage.getItem(INIT_DATA_STORAGE_KEY)
  } catch {
    return null
  }
}
