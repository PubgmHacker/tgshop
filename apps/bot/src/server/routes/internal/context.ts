import type { Locale } from '../../../i18n/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// /internal/* is consumed by services and agents, not humans, so its error
// messages use a single fixed locale rather than negotiating one per request.
// ─────────────────────────────────────────────────────────────────────────────

export function internalLocale(): Locale {
  return 'en'
}
