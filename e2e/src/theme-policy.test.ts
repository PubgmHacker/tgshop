import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { DEFAULT_THEME, storedTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@tgshop/ui/theme'

describe('theme before hydration', () => {
  it('defaults to light without browser storage', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(storedTheme()).toBe('light')
  })

  it.each([null, '', 'system', 'corrupt'])('uses light for an absent or invalid stored value: %s', value => {
    expect(storedTheme({ getItem: () => value })).toBe('light')
  })

  it.each(['light', 'dark'] as const)('preserves an explicit %s preference', value => {
    expect(storedTheme({ getItem: () => value })).toBe(value)
  })

  it('works when private-mode storage throws', () => {
    expect(storedTheme({ getItem: () => { throw new Error('Storage disabled') } })).toBe('light')
  })

  it.each([['dark', 'dark'], ['light', 'light'], ['invalid', 'light'], [null, 'light']])('sets the document before app hydration (%s)', (value, expected) => {
    const root = { dataset: { theme: 'light' } }
    runInNewContext(THEME_INIT_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => key === THEME_STORAGE_KEY ? value : null }
    })
    expect(root.dataset.theme).toBe(expected)
  })

  it('keeps the document light when localStorage is unavailable', () => {
    const root = { dataset: { theme: 'light' } }
    runInNewContext(THEME_INIT_SCRIPT, { document: { documentElement: root } })
    expect(root.dataset.theme).toBe('light')
  })
})
