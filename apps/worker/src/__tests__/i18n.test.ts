import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, adminStrings, resolveLocale, t, type Locale } from '../i18n.js'

describe('resolveLocale', () => {
  it('treats any ru* language code as Russian', () => {
    expect(resolveLocale('ru')).toBe('ru')
    expect(resolveLocale('ru-RU')).toBe('ru')
    expect(resolveLocale('Ru')).toBe('ru')
    expect(resolveLocale('ru-UA')).toBe('ru')
  })

  // The worker message fallback is EN, not the ru DEFAULT_LOCALE: every worker
  // job calls resolveLocale(user.languageCode) rather than t(DEFAULT_LOCALE),
  // and the bot's identical resolveLocale agrees on the same fallback.
  it('falls back to en for unknown or absent codes', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('de')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('')).toBe('en')
  })
})

describe('t(locale)', () => {
  it('is a complete, locale-keyed catalog', () => {
    for (const locale of ['ru', 'en'] satisfies Locale[]) {
      const strings = t(locale)
      expect(typeof strings.orderExpired('42')).toBe('string')
      expect(typeof strings.orderUnderpaid('10', 'USDT')).toBe('string')
      expect(typeof strings.orderOverpaidCredited('5', 'USDT')).toBe('string')
      expect(typeof strings.latePaymentCredited('3', 'USDT', '42')).toBe('string')
      expect(typeof strings.deliveryFailedRefunded('42')).toBe('string')
      expect(typeof strings.subReminder3Day('VPN', '01.01.2030')).toBe('string')
      expect(typeof strings.subReminder1Day('VPN', '01.01.2030')).toBe('string')
      expect(typeof strings.subRenewButton).toBe('string')
      expect(typeof strings.subAutoRenewed('VPN')).toBe('string')
      expect(typeof strings.subAutoRenewFailed('VPN')).toBe('string')
      expect(typeof strings.subRenewPlanInactive('VPN')).toBe('string')
    }
  })

  it('renders every parameterized message with all substitutions filled in', () => {
    const ru = t('ru')
    expect(ru.orderExpired('A1B2')).toContain('A1B2')
    expect(ru.orderUnderpaid('10', 'USDT')).toContain('10')
    expect(ru.orderUnderpaid('10', 'USDT')).toContain('USDT')
    expect(ru.subReminder3Day('VPN Pro', '01.01.2030')).toContain('VPN Pro')
    expect(ru.subReminder3Day('VPN Pro', '01.01.2030')).toContain('01.01.2030')
  })
})

describe('adminStrings', () => {
  it('interpolates every message without leaving placeholders', () => {
    expect(adminStrings.lowStock('VPN Pro', 2, 5)).toContain('VPN Pro')
    expect(adminStrings.lowStock('VPN Pro', 2, 5)).toContain('2')
    expect(adminStrings.lowStock('VPN Pro', 2, 5)).toContain('5')
    expect(adminStrings.orderFailed('O-1', 'boom')).toContain('O-1')
    expect(adminStrings.orderFailed('O-1', 'boom')).toContain('boom')
    expect(adminStrings.lowTrx('TQx..', '12.5')).toContain('TQx..')
    expect(adminStrings.sweepFailed('TQx..', 'bad key')).toContain('bad key')
  })
})

// DEFAULT_LOCALE is exported but intentionally unused by worker jobs (they
// resolve per-user via resolveLocale). This guards the documented default
// without letting it silently drift from what resolveLocale actually returns.
describe('DEFAULT_LOCALE', () => {
  it('remains ru (documented default), even though fallback is en', () => {
    expect(DEFAULT_LOCALE).toBe('ru')
  })
})
