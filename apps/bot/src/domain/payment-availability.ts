import { PaymentProvider } from '@tgshop/db'
import { env } from '../config/env.js'
import { isTronAddress, resolveTronReceiveAddress } from '../payments/tron-address.js'

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
  'placeholder'
])

function configured(value: string | undefined): boolean {
  if (!value) return false
  return !EMPTY_OR_PLACEHOLDER.has(value.trim().toLowerCase())
}

/** Rails that can fund the internal balance (BALANCE itself obviously cannot). */
export type TopupProvider = 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'

export interface PaymentAvailability {
  orderProviders: PaymentProvider[]
  topupProviders: TopupProvider[]
}

/**
 * TRON needs exactly two things: the owner's receive address (a well-formed
 * T-address, or money is lost) and the USDT contract the worker filters
 * transfers by. No keys — the rail is read-only on our side.
 */
export function isTronConfigured(): boolean {
  return resolveTronReceiveAddress(env) !== null && isTronAddress(env.TRON_USDT_CONTRACT)
}

export function getPaymentAvailability(): PaymentAvailability {
  const orderProviders: PaymentProvider[] = [PaymentProvider.BALANCE, PaymentProvider.STARS]
  const topupProviders: TopupProvider[] = ['STARS']

  if (configured(env.CRYPTOBOT_API_TOKEN)) {
    orderProviders.splice(1, 0, PaymentProvider.CRYPTOBOT)
    topupProviders.unshift('CRYPTOBOT')
  }

  if (isTronConfigured()) {
    orderProviders.push(PaymentProvider.TRON_TRC20)
    topupProviders.push('TRON_TRC20')
  }

  return { orderProviders, topupProviders }
}

export function isPaymentProviderAvailable(provider: PaymentProvider): boolean {
  return getPaymentAvailability().orderProviders.includes(provider)
}

export function isTopupProviderAvailable(provider: string): provider is TopupProvider {
  return getPaymentAvailability().topupProviders.includes(provider as TopupProvider)
}
