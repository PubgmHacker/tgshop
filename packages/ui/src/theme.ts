export type Theme = 'light' | 'dark'
export const DEFAULT_THEME: Theme = 'light'
export const THEME_STORAGE_KEY = 'tgshop.theme'

export function storedTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : DEFAULT_THEME
  } catch { return DEFAULT_THEME }
}

// A constant script, never interpolated with user input. Runs before the page paints.
export const THEME_INIT_SCRIPT = `(function(){var t=${JSON.stringify(DEFAULT_THEME)};try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(s==='light'||s==='dark')t=s;}catch(e){}document.documentElement.dataset.theme=t;})();`

let switchFrame: number | undefined

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (root.dataset.theme === theme) return
  if (switchFrame !== undefined) cancelAnimationFrame(switchFrame)
  root.dataset.themeSwitching = ''
  root.dataset.theme = theme
  // Apply the new colors together; preserve the ongoing glass-sheen keyframes.
  void root.offsetHeight
  switchFrame = requestAnimationFrame(() => {
    delete root.dataset.themeSwitching
    switchFrame = undefined
  })
}
