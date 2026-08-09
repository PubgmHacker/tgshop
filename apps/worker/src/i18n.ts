// ─────────────────────────────────────────────────────────────────────────────
// User-facing string catalog for @tgshop/worker (RU + EN). All Telegram
// messages sent by worker jobs must be pulled from here — no inline literals.
// ─────────────────────────────────────────────────────────────────────────────

export type Locale = 'ru' | 'en'

export const DEFAULT_LOCALE: Locale = 'ru'

export function resolveLocale(languageCode: string | null | undefined): Locale {
  if (languageCode && languageCode.toLowerCase().startsWith('ru')) return 'ru'
  return 'en'
}

interface Strings {
  orderExpired: (orderId: string) => string
  orderUnderpaid: (shortfallDisplay: string, asset: string) => string
  orderOverpaidCredited: (surplusDisplay: string, asset: string) => string
  latePaymentCredited: (amountDisplay: string, asset: string, orderId: string) => string
  deliveryFailedRefunded: (orderId: string) => string
  subReminder3Day: (planTitle: string, expiresAtDisplay: string) => string
  subReminder1Day: (planTitle: string, expiresAtDisplay: string) => string
  subRenewButton: string
  subAutoRenewed: (planTitle: string) => string
  subAutoRenewFailed: (planTitle: string) => string
  subRenewPlanInactive: (planTitle: string) => string
}

const ru: Strings = {
  orderExpired: (orderId) => `⏰ Заказ ${orderId} отменён: время оплаты истекло.`,
  orderUnderpaid: (shortfallDisplay, asset) =>
    `⚠️ Оплата получена не полностью. Не хватает ${shortfallDisplay} ${asset}. Средства зачислены на баланс — доплатите или используйте баланс для новой покупки.`,
  orderOverpaidCredited: (surplusDisplay, asset) =>
    `✅ Оплата получена с переплатой. Излишек ${surplusDisplay} ${asset} зачислен на ваш баланс.`,
  latePaymentCredited: (amountDisplay, asset, orderId) =>
    `ℹ️ Платёж по заказу ${orderId} пришёл после истечения срока оплаты. ${amountDisplay} ${asset} зачислены на баланс.`,
  deliveryFailedRefunded: (orderId) =>
    `❌ Не удалось доставить заказ ${orderId}. Средства возвращены на баланс. Мы уже разбираемся.`,
  subReminder3Day: (planTitle, expiresAtDisplay) =>
    `🔔 Подписка «${planTitle}» истекает через 3 дня (${expiresAtDisplay}). Продлите заранее, чтобы не потерять доступ.`,
  subReminder1Day: (planTitle, expiresAtDisplay) =>
    `⏳ Подписка «${planTitle}» истекает завтра (${expiresAtDisplay})! Продлите сейчас.`,
  subRenewButton: '🔁 Продлить',
  subAutoRenewed: (planTitle) => `✅ Подписка «${planTitle}» автоматически продлена с вашего баланса.`,
  subAutoRenewFailed: (planTitle) =>
    `⚠️ Не удалось автоматически продлить «${planTitle}»: недостаточно средств на балансе. Продлите вручную.`,
  // Отдельный текст: тариф снят с продажи, и совет «пополните баланс» здесь
  // только сбил бы с толку — деньги не помогут, продлевать больше нечего.
  subRenewPlanInactive: (planTitle) =>
    `⚠️ Тариф «${planTitle}» больше не доступен, поэтому подписка не продлена. Напишите в поддержку — подберём замену.`
}

const en: Strings = {
  orderExpired: (orderId) => `⏰ Order ${orderId} was cancelled: payment window expired.`,
  orderUnderpaid: (shortfallDisplay, asset) =>
    `⚠️ Payment received but incomplete. Missing ${shortfallDisplay} ${asset}. Funds were credited to your balance — top up the difference or use your balance for a new purchase.`,
  orderOverpaidCredited: (surplusDisplay, asset) =>
    `✅ Payment received with overpayment. The surplus of ${surplusDisplay} ${asset} was credited to your balance.`,
  latePaymentCredited: (amountDisplay, asset, orderId) =>
    `ℹ️ Payment for order ${orderId} arrived after the payment window expired. ${amountDisplay} ${asset} was credited to your balance.`,
  deliveryFailedRefunded: (orderId) =>
    `❌ We could not deliver order ${orderId}. Your funds were refunded to your balance. We're looking into it.`,
  subReminder3Day: (planTitle, expiresAtDisplay) =>
    `🔔 Your "${planTitle}" subscription expires in 3 days (${expiresAtDisplay}). Renew now to keep access.`,
  subReminder1Day: (planTitle, expiresAtDisplay) =>
    `⏳ Your "${planTitle}" subscription expires tomorrow (${expiresAtDisplay})! Renew now.`,
  subRenewButton: '🔁 Renew',
  subAutoRenewed: (planTitle) => `✅ Your "${planTitle}" subscription was auto-renewed from your balance.`,
  subAutoRenewFailed: (planTitle) =>
    `⚠️ Could not auto-renew "${planTitle}": insufficient balance. Please renew manually.`,
  subRenewPlanInactive: (planTitle) =>
    `⚠️ The "${planTitle}" plan is no longer available, so your subscription was not renewed. Contact support and we'll find you an alternative.`
}

const catalogs: Record<Locale, Strings> = { ru, en }

export function t(locale: Locale): Strings {
  return catalogs[locale]
}

// ─── Admin-facing strings (always EN, internal ops) ─────────────────────────

export const adminStrings = {
  lowStock: (planTitle: string, remaining: number, threshold: number) =>
    `📦 LOW STOCK: plan "${planTitle}" has ${remaining} item(s) left (threshold ${threshold}).`,
  orderFailed: (orderId: string, reason: string) =>
    `🛑 ORDER FAILED: ${orderId} — ${reason}. Refunded to user balance.`,
  lowTrx: (address: string, balanceTrxDisplay: string) =>
    `⛽ LOW TRX: hot wallet ${address} has only ${balanceTrxDisplay} TRX for energy/bandwidth. Top up soon.`,
  manualFallbackSla: (orderId: string, ageMinutes: number) =>
    `🐢 MANUAL FALLBACK SLA: order ${orderId} has been pending manual delivery for ${ageMinutes} min.`,
  sweepFailed: (address: string, reason: string) => `🧹 SWEEP FAILED for ${address}: ${reason}`,
  chainScanError: (reason: string) => `🔴 chain:scan job errored: ${reason}`
}
