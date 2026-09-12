'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/button'

/** Simple class-based dark mode toggle, persisted in localStorage, no FOUC via inline script in layout. */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { window.localStorage.setItem('tgshop-admin-theme', next ? 'dark' : 'light') } catch { /* Theme still changes when storage is unavailable. */ }
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}>
      {isDark ? 'Светлая тема' : 'Тёмная тема'}
    </Button>
  )
}
