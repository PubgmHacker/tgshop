'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Branded dark/light theme, deliberately independent of Telegram's own theme:
// the storefront keeps its premium look in every client. Default is dark; the
// choice persists in localStorage and applies via data-theme on <html>
// (styles/globals.css owns the actual palettes).
// ─────────────────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'tgshop.theme'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => undefined,
  setTheme: () => undefined
})

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
    return 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<Theme>('dark')

  // Read after mount: SSR markup must not depend on localStorage.
  useEffect(() => {
    const stored = readStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
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
