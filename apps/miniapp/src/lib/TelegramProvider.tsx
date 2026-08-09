'use client'

import {
  backButton,
  hapticFeedback,
  init as initSdk,
  mainButton,
  retrieveLaunchParams,
  themeParams,
  viewport
} from '@telegram-apps/sdk-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FALLBACK_THEME, type ThemeParamKey } from './tokens'
import { setInitData } from './apiClient'

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

const THEME_VAR_MAP: Record<ThemeParamKey, string> = {
  bg_color: '--tg-bg-color',
  text_color: '--tg-text-color',
  hint_color: '--tg-hint-color',
  link_color: '--tg-link-color',
  button_color: '--tg-button-color',
  button_text_color: '--tg-button-text-color',
  secondary_bg_color: '--tg-secondary-bg-color',
  header_bg_color: '--tg-header-bg-color',
  accent_text_color: '--tg-accent-text-color',
  section_bg_color: '--tg-section-bg-color',
  section_header_text_color: '--tg-section-header-text-color',
  subtitle_text_color: '--tg-subtitle-text-color',
  destructive_text_color: '--tg-destructive-text-color'
}

function applyThemeToDocument(params: Partial<Record<ThemeParamKey, string>>): void {
  const root = document.documentElement
  for (const key of Object.keys(THEME_VAR_MAP) as ThemeParamKey[]) {
    const value = params[key] ?? FALLBACK_THEME[key]
    root.style.setProperty(THEME_VAR_MAP[key], value)
  }
}

export function TelegramProvider({ children }: { children: ReactNode }): JSX.Element {
  const [isReady, setIsReady] = useState(false)
  const [isTelegramEnvironment, setIsTelegramEnvironment] = useState(false)
  const [languageCode, setLanguageCode] = useState<string | null>(null)
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    // Always apply the fallback theme immediately so first paint never flashes unstyled.
    applyThemeToDocument({})

    try {
      initSdk()

      const launchParams = retrieveLaunchParams()
      const rawInitData = launchParams.initDataRaw
      if (rawInitData) {
        setInitData(rawInitData)
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

      if (themeParams.mount.isAvailable()) {
        themeParams.mount()
        themeParams.bindCssVars()
        applyThemeToDocument(themeParams.state() as Partial<Record<ThemeParamKey, string>>)
      }

      if (backButton.mount.isAvailable()) {
        backButton.mount()
      }

      if (mainButton.mount.isAvailable()) {
        mainButton.mount()
      }
    } catch {
      // Not running inside Telegram (e.g. local dev in a plain browser).
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
