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
import { readInitDataFromLocation } from './launchParams'

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

    try {
      initSdk()

      const launchParams = retrieveLaunchParams()
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
        void viewport.mount().then(() => {
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
    } catch {
      // Not running inside Telegram (e.g. local dev in a plain browser).
      // Keep any initData captured from the launch hash so API auth still works.
      bootstrapInitData()
      setIsTelegramEnvironment(false)
    } finally {
      setIsReady(true)
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
