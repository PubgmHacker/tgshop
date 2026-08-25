import { InlineKeyboard, Keyboard } from 'grammy'
import { t, type Locale } from '../../i18n/index.js'
import { env } from '../../config/env.js'
import { versionedWebAppUrl } from '../webAppUrls.js'

// The reply keyboard must never carry a web_app button: Telegram opens
// KeyboardButton.web_app launches WITHOUT initData (that variant exists for
// the Telegram.WebApp.sendData flow), so the miniapp cannot authenticate and
// every screen degrades to the network-error state. Mini App entry points
// live only where initData IS passed: the ≡ chat menu button (commands.ts)
// and inline web_app buttons (openShopKeyboard below, /admin).
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
    .resized()
}

export function openShopKeyboard(locale: Locale) {
  return new InlineKeyboard().webApp(
    t(locale, 'menu.open_miniapp'),
    versionedWebAppUrl(env.MINIAPP_URL)
  )
}
