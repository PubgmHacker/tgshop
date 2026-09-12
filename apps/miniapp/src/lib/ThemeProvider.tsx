'use client'

import { DEFAULT_THEME, THEME_STORAGE_KEY, applyTheme, storedTheme, type Theme } from '@tgshop/ui/theme'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Branded dark/light theme, deliberately independent of Telegram's own theme:
// the storefront keeps its premium look in every client. Default is light; the
// choice persists in localStorage and applies via data-theme on <html>
// (styles/globals.css owns the actual palettes).
// ─────────────────────────────────────────────────────────────────────────────

export type { Theme } from '@tgshop/ui/theme'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  toggleTheme: () => undefined,
  setTheme: () => undefined
})

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try { return storedTheme(window.localStorage) } catch { return DEFAULT_THEME }
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  // Read after mount: SSR markup must not depend on localStorage.
  useEffect(() => {
    const stored = readStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      const next = readStoredTheme()
      setThemeState(next)
      applyTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private mode without storage: the theme still applies for the session.
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
