/**
 * Single source of truth for brand tokens. Rebranding = edit this file only.
 * BRAND_NAME is a placeholder until real brand assets exist.
 */

export const BRAND_NAME = 'BRAND_NAME'

/** Accent gradient used for primary CTAs, badges, and highlights. */
export const ACCENT_GRADIENT_FROM = '#6C5CE7'
export const ACCENT_GRADIENT_TO = '#00CEC9'

/** Fallback palette used before Telegram theme params arrive (first paint). */
export const FALLBACK_THEME = {
  bg_color: '#0f0f13',
  text_color: '#ffffff',
  hint_color: '#8a8a94',
  link_color: '#6C5CE7',
  button_color: '#6C5CE7',
  button_text_color: '#ffffff',
  secondary_bg_color: '#17171c',
  header_bg_color: '#0f0f13',
  accent_text_color: '#6C5CE7',
  section_bg_color: '#17171c',
  section_header_text_color: '#8a8a94',
  subtitle_text_color: '#8a8a94',
  destructive_text_color: '#ff5c5c'
} as const

export type ThemeParamKey = keyof typeof FALLBACK_THEME
