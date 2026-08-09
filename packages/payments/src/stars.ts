import { z } from 'zod'
import { PaymentConfigError, PaymentProviderHttpError } from './errors.js'
import type {
  CreateInvoiceInput,
  CreatedInvoice,
  PaymentProvider,
  RawWebhook,
  VerifiedEvent
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Stars (XTR) provider.
//
// Stars payments flow entirely through the Telegram Bot API, not a separate
// webhook endpoint: the bot calls `sendInvoice` (currency 'XTR', empty
// provider_token, prices in whole Stars — Stars has no fractional unit), the
// client answers a `pre_checkout_query` (handled via `answerPreCheckoutQuery`
// helper semantics below), and Telegram delivers a `successful_payment`
// update once paid. There is no HTTP webhook signature to verify here; the
// authenticity guarantee instead comes from grammY/the Bot API's own
// long-poll/webhook transport (already authenticated via the bot token /
// Telegram's webhook secret token at the app layer). `verifyWebhook` on this
// adapter therefore expects `rawBody` to contain the JSON-encoded Telegram
// Update (as delivered to our bot webhook route) and simply validates shape.
// ─────────────────────────────────────────────────────────────────────────────

export const StarsConfigSchema = z.object({
  botToken: z.string().min(1),
  apiBaseUrl: z.string().url().default('https://api.telegram.org')
})
export type StarsConfig = z.infer<typeof StarsConfigSchema>

export interface SendInvoiceInput {
  chatId: number
  orderId: string
  title: string
  description: string
  /** Whole Stars amount (Int), never fractional. */
  priceStars: number
  payload?: string
}

export interface SendInvoiceLabeledPrice {
  label: string
  amount: number
}

export interface SendInvoicePayload {
  chat_id: number
  title: string
  description: string
  payload: string
  provider_token: ''
  currency: 'XTR'
  prices: SendInvoiceLabeledPrice[]
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

interface PreCheckoutQuery {
  id: string
  from: { id: number }
  currency: string
  total_amount: number
  invoice_payload: string
}

interface SuccessfulPayment {
  currency: string
  total_amount: number
  invoice_payload: string
  telegram_payment_charge_id: string
  provider_payment_charge_id: string
}

interface TelegramUpdate {
  update_id: number
  pre_checkout_query?: PreCheckoutQuery
  message?: {
    successful_payment?: SuccessfulPayment
  }
}

export interface StarsDeps {
  fetchImpl?: typeof fetch
  now?: () => Date
}

/**
 * Converts a USD-cents amount to whole Stars using the STARS_USD_RATE Setting
 * (stars per USD dollar, as an integer-safe rateNumerator/rateDenominator
 * pair — e.g. rate "1.35 stars per $1" => numerator=135, denominator=100),
 * with an optional per-plan `priceStarsOverride` taking precedence.
 */
export function usdCentsToStarsWithOverride(
  amountCents: number,
  rateNumerator: bigint,
  rateDenominator: bigint,
  priceStarsOverride?: number | null
): number {
  if (priceStarsOverride !== undefined && priceStarsOverride !== null) {
    if (!Number.isInteger(priceStarsOverride) || priceStarsOverride <= 0) {
      throw new PaymentConfigError(`Invalid priceStarsOverride: ${priceStarsOverride}`)
    }
    return priceStarsOverride
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new PaymentConfigError(`Invalid amountCents: ${amountCents}`)
  }
  if (rateDenominator <= 0n) {
    throw new PaymentConfigError('rateDenominator must be positive')
  }
  // amountCents is USD/100; multiply by (rate stars-per-USD) then divide by 100.
  const numerator = BigInt(amountCents) * rateNumerator
  const denominator = rateDenominator * 100n
  const doubled = numerator * 2n
  const quotient = doubled / denominator
  const remainder = doubled % denominator
  const rounded = remainder === 0n ? quotient : quotient + 1n
  const stars = rounded / 2n
  return Number(stars < 1n ? 1n : stars)
}

export function buildSendInvoicePayload(input: SendInvoiceInput): SendInvoicePayload {
  if (!Number.isInteger(input.priceStars) || input.priceStars <= 0) {
    throw new PaymentConfigError(`priceStars must be a positive integer, got ${input.priceStars}`)
  }
  return {
    chat_id: input.chatId,
    title: input.title,
    description: input.description,
    payload: input.payload ?? input.orderId,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: input.title, amount: input.priceStars }]
  }
}

/**
 * Semantics for answering a pre_checkout_query: Telegram requires an answer
 * within 10 seconds. `validate` receives the parsed query and returns either
 * { ok: true } or { ok: false, errorMessage } to show the user.
 */
export async function answerPreCheckoutQuery(
  config: StarsConfig,
  query: PreCheckoutQuery,
  validate: (query: PreCheckoutQuery) => Promise<{ ok: true } | { ok: false; errorMessage: string }>,
  deps: StarsDeps = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const outcome = await validate(query)
  const body =
    outcome.ok === true
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: outcome.errorMessage }

  const res = await fetchImpl(`${config.apiBaseUrl}/bot${config.botToken}/answerPreCheckoutQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = (await res.json()) as TelegramApiResponse<boolean>
  if (!res.ok || !json.ok) {
    throw new PaymentProviderHttpError('answerPreCheckoutQuery failed', res.status, json)
  }
}

/** Maps a Telegram `successful_payment` object to our unified VerifiedEvent. */
function mapSuccessfulPayment(payment: SuccessfulPayment): VerifiedEvent {
  return {
    provider: 'stars',
    invoiceId: payment.telegram_payment_charge_id,
    orderId: payment.invoice_payload,
    status: 'paid',
    amount: String(payment.total_amount),
    asset: 'XTR',
    txHash: payment.telegram_payment_charge_id,
    raw: payment
  }
}

/**
 * Refunds a Stars payment via the Bot API `refundStarPayment` method.
 * `telegramPaymentChargeId` is the id captured on the successful_payment event.
 */
export async function refundStarPayment(
  config: StarsConfig,
  userId: number,
  telegramPaymentChargeId: string,
  deps: StarsDeps = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const res = await fetchImpl(`${config.apiBaseUrl}/bot${config.botToken}/refundStarPayment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, telegram_payment_charge_id: telegramPaymentChargeId })
  })
  const json = (await res.json()) as TelegramApiResponse<boolean>
  if (!res.ok || !json.ok) {
    throw new PaymentProviderHttpError('refundStarPayment failed', res.status, json)
  }
}

export function createStarsProvider(config: StarsConfig, deps: StarsDeps = {}): PaymentProvider {
  const now = deps.now ?? (() => new Date())

  return {
    id: 'stars',

    async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
      // Stars invoices are delivered in-chat via sendInvoice, not a hosted
      // URL; callers should use buildSendInvoicePayload + grammY's api.sendInvoice
      // directly with the chatId. This method exists to satisfy the common
      // PaymentProvider interface for registry-driven flows that only need an
      // invoiceId/expiry (e.g. background reconciliation bookkeeping).
      const expiresAt = new Date(now().getTime() + 15 * 60 * 1000)
      return {
        invoiceId: input.orderId,
        amount: input.amountCents.toString(),
        asset: 'XTR',
        expiresAt
      }
    },

    async verifyWebhook(raw: RawWebhook): Promise<VerifiedEvent | null> {
      let update: TelegramUpdate
      try {
        update = JSON.parse(raw.rawBody.toString('utf8')) as TelegramUpdate
      } catch {
        return null
      }
      const payment = update.message?.successful_payment
      if (!payment || payment.currency !== 'XTR') {
        return null
      }
      return mapSuccessfulPayment(payment)
    },

    async checkStatus(): Promise<'pending' | 'paid' | 'expired' | 'failed'> {
      // Stars has no polling endpoint for invoice status; status is only
      // known via the successful_payment update captured in verifyWebhook.
      // Callers relying on checkStatus for Stars should track state from
      // the webhook/update instead of polling.
      return 'pending'
    }
  }
}
