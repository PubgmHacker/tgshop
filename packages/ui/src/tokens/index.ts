/**
 * ─────────────────────────────────────────────────────────────────────────────
 * @tgshop/ui design tokens
 *
 * SINGLE SOURCE OF TRUTH for rebranding. To rebrand the entire product
 * (miniapp + landing + admin), edit ONLY the values in this file, then
 * rebuild @tgshop/ui. Everything else (Tailwind preset, components, CSS
 * variables) derives from these objects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Core brand accent — the single gradient/color used across all surfaces. */
export const colors = {
  accent: {
    50: '#fff4f2',
    100: '#ffe4de',
    200: '#ffc4b8',
    300: '#ff9d8a',
    400: '#fa7259',
    500: '#e8552f', // primary brand accent
    600: '#c8441f',
    700: '#a3371a',
    800: '#7c2c16',
    900: '#5c2212'
  },
  neutral: {
    0: '#ffffff',
    50: '#f7f7f8',
    100: '#eeeef0',
    200: '#dcdce0',
    300: '#c2c2c8',
    400: '#96969f',
    500: '#6c6c76',
    600: '#4d4d57',
    700: '#35353d',
    800: '#212126',
    900: '#121214',
    950: '#08080a'
  },
  success: {
    500: '#22a06b',
    600: '#178257'
  },
  warning: {
    500: '#e0a020',
    600: '#b9821a'
  },
  danger: {
    500: '#e0403f',
    600: '#b73231'
  },
  info: {
    500: '#3b8ce0',
    600: '#2c6fb5'
  }
} as const

/** Brand gradient stops (in order). Used for hero surfaces, primary buttons, badges. */
export const gradient = {
  accent: [colors.accent[400], colors.accent[500], colors.accent[700]] as const,
  angleDeg: 135
} as const

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px'
} as const

export const radii = {
  none: '0px',
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '24px',
  full: '9999px'
} as const

export const fontSizes = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
  '4xl': '36px'
} as const

export const fontWeights = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700'
} as const

export const shadows = {
  sm: '0 1px 2px rgba(8, 8, 10, 0.06)',
  md: '0 4px 12px rgba(8, 8, 10, 0.10)',
  lg: '0 12px 32px rgba(8, 8, 10, 0.16)',
  accentGlow: `0 8px 24px ${colors.accent[500]}40`
} as const

export const durations = {
  fast: '120ms',
  base: '200ms',
  slow: '320ms'
} as const

export const easings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)'
} as const

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500
} as const

export const tokens = {
  colors,
  gradient,
  spacing,
  radii,
  fontSizes,
  fontWeights,
  shadows,
  durations,
  easings,
  zIndex
} as const

export type Tokens = typeof tokens
