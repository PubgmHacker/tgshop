import { PaymentProvider } from '@tgshop/db'
import { env } from '../config/env.js'

/**
 * Payment rails are feature flags derived from the credentials that are
 * actually present in the running service. Keeping this decision in one module
 * prevents the Mini App, bot keyboards and API validation from drifting apart.
 *
 * BALANCE and Stars are always available in a correctly booted bot: the former
 * is our own ledger and the latter uses BOT_TOKEN. CryptoBot and TRON are
 * optional integrations and must never be shown until their minimum safe
 * configuration exists.
 */

const EMPTY_OR_PLACEHOLDER = new Set([
  '',
  'changeme',
  'change-me',
  'replace-me',
  'replace_me',
  'placeholder',
  'xpub-placeholder'
])

function configured(value: string | undefined): boolean {
  if (!value) return false
  return !EMPTY_OR_PLACEHOLDER.has(value.trim().toLowerCase())
}

export interface PaymentAvailability {
  orderProviders: PaymentProvider[]
  topupProviders: Array<'CRYPTOBOT' | 'STARS'>
}

export function getPaymentAvailability(): PaymentAvailability {
  const orderProviders: PaymentProvider[] = [PaymentProvider.BALANCE, PaymentProvider.STARS]
  const topupProviders: Array<'CRYPTOBOT' | 'STARS'> = ['STARS']

  if (configured(env.CRYPTOBOT_API_TOKEN)) {
    orderProviders.splice(1, 0, PaymentProvider.CRYPTOBOT)
    topupProviders.unshift('CRYPTOBOT')
  }

  // A static treasury address is not enough for this implementation: each
  // order needs a derived deposit address that the worker can later reconcile.
  if (configured(env.TRON_MASTER_XPUB) && configured(env.TRON_USDT_CONTRACT)) {
    orderProviders.push(PaymentProvider.TRON_TRC20)
  }

  return { orderProviders, topupProviders }
}

export function isPaymentProviderAvailable(provider: PaymentProvider): boolean {
  return getPaymentAvailability().orderProviders.includes(provider)
}

export function isTopupProviderAvailable(provider: string): provider is 'CRYPTOBOT' | 'STARS' {
  return getPaymentAvailability().topupProviders.includes(provider as 'CRYPTOBOT' | 'STARS')
}
