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
    window.localStorage.setItem('tgshop-admin-theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} aria-label="Toggle theme">
      {isDark ? 'Light' : 'Dark'}
    </Button>
  )
}
