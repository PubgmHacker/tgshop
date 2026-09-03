'use client'

import {
  backButton,
  hapticFeedback,
  init as initSdk,
  mainButton,
  retrieveLaunchParams,
  viewport
} from '@telegram-apps/sdk-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { setInitData } from './apiClient'
import { probeInitData, readInitDataFromLocation } from './launchParams'

interface TelegramContextValue {
  isReady: boolean
  isTelegramEnvironment: boolean
  languageCode: string | null
}

const TelegramContext = createContext<TelegramContextValue>({
  isReady: false,
  isTelegramEnvironment: false,
  languageCode: null
})

// Telegram themeParams are deliberately NOT bound to CSS variables: the shop
// ships its own branded dark/light palettes (lib/ThemeProvider.tsx), the same
// in every Telegram client, with a manual toggle in the header.

function bootstrapInitData(): void {
  const fromLocation = readInitDataFromLocation()
  if (fromLocation) {
    setInitData(fromLocation)
  }
}

/** Key names and value lengths only — never the values themselves. */
function describeParams(raw: string): string {
  if (!raw) return '-'
  const trimmed = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  try {
    const parts: string[] = []
    new URLSearchParams(trimmed).forEach((value, key) => {
      parts.push(`${key}:${value.length}`)
    })
    return parts.length > 0 ? parts.join(',') : '-'
  } catch {
    return 'unparsable'
  }
}

/**
 * One fire-and-forget GET per boot. The middleware logs the query string, so
 * a phone that renders «нет соединения» still tells the server logs exactly
 * what launch state it saw — which is how this incident gets diagnosed
 * without physical access to the device.
 */
function sendBootBeacon(fields: Record<string, string>): void {
  try {
    void fetch(`/client-log?${new URLSearchParams(fields).toString()}`, { keepalive: true }).catch(
      () => {}
    )
  } catch {
    // diagnostics must never break the app
  }
}

export function TelegramProvider({ children }: { children: ReactNode }): JSX.Element {
  const [isReady, setIsReady] = useState(false)
  const [isTelegramEnvironment, setIsTelegramEnvironment] = useState(false)
  const [languageCode, setLanguageCode] = useState<string | null>(null)
  const didInit = useRef(false)
  const didBootstrap = useRef(false)

  // Set initData during the first client render so child useEffects / React Query
  // do not race the parent useEffect (children effects flush first).
  if (typeof window !== 'undefined' && !didBootstrap.current) {
    didBootstrap.current = true
    bootstrapInitData()
  }

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    // Hash/query fallback for local browser verification and tdesktop launch URLs.
    bootstrapInitData()

    // Launch state before the SDK touches (and possibly strips) the URL.
    const entryHash = window.location.hash
    const entrySearch = window.location.search
    let navigationUrl = ''
    try {
      navigationUrl = performance.getEntriesByType('navigation')[0]?.name ?? ''
    } catch {
      navigationUrl = ''
    }
    let platform = '-'
    let sdkError = ''

    try {
      initSdk()

      const launchParams = retrieveLaunchParams()
      platform = `${launchParams.platform ?? '-'}@${launchParams.version ?? '-'}`
      const rawInitData = launchParams.initDataRaw
      if (rawInitData) {
        setInitData(rawInitData)
      } else {
        bootstrapInitData()
      }
      setIsTelegramEnvironment(true)
      // Telegram reports the user's own app language; fall back to the browser's.
      setLanguageCode(launchParams.initData?.user?.languageCode ?? window.navigator.language ?? null)

      if (viewport.mount.isAvailable()) {
        void viewport.mount().catch(() => undefined).then(() => {
          viewport.expand()
          viewport.bindCssVars()
        })
      }

      if (backButton.mount.isAvailable()) {
        backButton.mount()
      }

      if (mainButton.mount.isAvailable()) {
        mainButton.mount()
      }
    } catch (err) {
      // Not running inside Telegram (e.g. local dev in a plain browser) — or a
      // strict SDK parser rejecting launch params a newer client sent.
      // Keep any initData captured from the launch hash so API auth still works.
      sdkError = err instanceof Error ? err.message : String(err)
      bootstrapInitData()
      setIsTelegramEnvironment(false)
    } finally {
      setIsReady(true)
      const finalProbe = probeInitData()
      sendBootBeacon({
        got: finalProbe.initData ? '1' : '0',
        src: finalProbe.source,
        hash: describeParams(entryHash),
        search: describeParams(entrySearch),
        nav: navigationUrl.includes('#') ? describeParams(navigationUrl.slice(navigationUrl.indexOf('#'))) : '-',
        tgobj: (window as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp ? '1' : '0',
        plat: platform,
        sdk: sdkError.slice(0, 120)
      })
    }
  }, [])

  const value = useMemo<TelegramContextValue>(
    () => ({ isReady, isTelegramEnvironment, languageCode }),
    [isReady, isTelegramEnvironment, languageCode]
  )

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>
}

export function useTelegram(): TelegramContextValue {
  return useContext(TelegramContext)
}

export function triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium'): void {
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred(style)
    }
  } catch {
    // no-op outside Telegram
  }
}

export function triggerNotificationHaptic(type: 'error' | 'success' | 'warning'): void {
  try {
    if (hapticFeedback.notificationOccurred.isAvailable()) {
      hapticFeedback.notificationOccurred(type)
    }
  } catch {
    // no-op outside Telegram
  }
}
