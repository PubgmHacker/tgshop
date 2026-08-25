import { Keyboard } from 'grammy'
import { t, type Locale } from '../../i18n/index.js'
import { env } from '../../config/env.js'
import { versionedWebAppUrl } from '../webAppUrls.js'

export function mainMenuKeyboard(locale: Locale) {
  return new Keyboard()
    .text(t(locale, 'menu.catalog'))
    .text(t(locale, 'menu.profile'))
    .row()
    .text(t(locale, 'menu.topup'))
    .text(t(locale, 'menu.purchases'))
    .row()
    .text(t(locale, 'menu.referrals'))
    .text(t(locale, 'menu.faq'))
    .row()
    .webApp(t(locale, 'menu.open_miniapp'), versionedWebAppUrl(env.MINIAPP_URL))
    .resized()
}
