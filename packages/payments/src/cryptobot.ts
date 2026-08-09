import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
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
// Crypto Pay (@CryptoBot) provider — https://help.crypt.bot/crypto-pay-api
//
// Webhook signature scheme: HMAC-SHA256 of the raw request body, keyed by
// SHA256(api_token) (per Crypto Pay API docs), compared against the
// `crypto-pay-api-signature` header using a timing-safe comparison. We MUST
// verify over the raw bytes (`rawBody`), never a re-serialized JSON.stringify
// of the parsed object — see the comment on RawWebhook in types.ts.
//
// Replay guard: webhooks include an `update_id`/payload with the invoice's
// `paid_at`/`created_at`. We reject any webhook whose event timestamp is more
// than 5 minutes old, closing the window for a captured request to be
// replayed later.
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_WINDOW_MS = 5 * 60 * 1000

export const CryptoBotConfigSchema = z.object({
  apiToken: z.string().min(1),
  /** 'mainnet' or 'testnet' base URL selection. */
  baseUrl: z.string().url().default('https://pay.crypt.bot/api'),
  webhookSignatureHeader: z.string().default('crypto-pay-api-signature'),
  defaultAsset: z.enum(['USDT', 'TON', 'BTC']).default('USDT'),
  invoiceExpirySeconds: z.number().int().positive().default(1800)
})
export type CryptoBotConfig = z.infer<typeof CryptoBotConfigSchema>

interface CryptoPayInvoiceResponse {
  ok: boolean
  result?: {
    invoice_id: number
    status: 'active' | 'paid' | 'expired'
    hash: string
    asset: string
    amount: string
    pay_url: string
    bot_invoice_url: string
    created_at: string
    expiration_date?: string
    paid_at?: string | null
    payload?: string
  }
  error?: { code: number; name: string }
}

interface CryptoPayGetInvoicesResponse {
  ok: boolean
  result?: {
    items: Array<{
      invoice_id: number
      status: 'active' | 'paid' | 'expired'
      asset: string
      amount: string
      payload?: string
      paid_at?: string | null
      created_at: string
      expiration_date?: string
    }>
  }
  error?: { code: number; name: string }
}

interface CryptoPayWebhookBody {
  update_id: number
  update_type: 'invoice_paid'
  request_date: string
  payload: {
    invoice_id: number
    status: 'paid'
    asset: string
    amount: string
    payload?: string
    paid_at: string
    paid_usd_rate?: string
  }
}

export interface CryptoBotDeps {
  fetchImpl?: typeof fetch
  now?: () => Date
}

export function createCryptoBotProvider(
  config: CryptoBotConfig,
  deps: CryptoBotDeps = {}
): PaymentProvider {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => new Date())
  const signatureKey = createHash('sha256').update(config.apiToken).digest()

  async function callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`${config.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Crypto-Pay-API-Token': config.apiToken
      },
      body: JSON.stringify(body)
    })
    const json = (await res.json()) as { ok: boolean; error?: unknown }
    if (!res.ok || !json.ok) {
      throw new PaymentProviderHttpError(`CryptoBot API ${method} failed`, res.status, json)
    }
    return json as T
  }

  return {
    id: 'cryptobot',

    async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
      const response = await callApi<CryptoPayInvoiceResponse>('createInvoice', {
        asset: config.defaultAsset,
        // Crypto Pay expects a decimal amount string; we convert cents to a
        // 2-decimal USD-equivalent string here only as the invoice display
        // amount request — the authoritative comparison on payment uses the
        // asset amount actually received (see verifyWebhook/checkStatus).
        amount: (input.amountCents / 100).toFixed(2),
        description: input.description,
        payload: input.orderId,
        allow_anonymous: false,
        expires_in: config.invoiceExpirySeconds
      })
      const result = response.result
      if (!result) {
        throw new PaymentConfigError('CryptoBot createInvoice returned no result')
      }
      const expiresAt = result.expiration_date
        ? new Date(result.expiration_date)
        : new Date(now().getTime() + config.invoiceExpirySeconds * 1000)
      return {
        invoiceId: String(result.invoice_id),
        payUrl: result.bot_invoice_url ?? result.pay_url,
        amount: result.amount,
        asset: result.asset,
        expiresAt
      }
    },

    async verifyWebhook(raw: RawWebhook): Promise<VerifiedEvent | null> {
      const signatureHeader = raw.headers[config.webhookSignatureHeader.toLowerCase()]
      if (!signatureHeader) {
        return null
      }
      const expectedSignature = createHmac('sha256', signatureKey).update(raw.rawBody).digest('hex')

      const providedBuf = Buffer.from(signatureHeader, 'hex')
      const expectedBuf = Buffer.from(expectedSignature, 'hex')
      if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
        return null
      }

      let body: CryptoPayWebhookBody
      try {
        body = JSON.parse(raw.rawBody.toString('utf8')) as CryptoPayWebhookBody
      } catch {
        return null
      }

      if (body.update_type !== 'invoice_paid' || !body.payload) {
        return null
      }

      const eventTime = new Date(body.payload.paid_at).getTime()
      if (!Number.isFinite(eventTime) || now().getTime() - eventTime > REPLAY_WINDOW_MS) {
        // Replay guard: reject events older than the allowed window.
        return null
      }

      return {
        provider: 'cryptobot',
        invoiceId: String(body.payload.invoice_id),
        orderId: body.payload.payload,
        status: 'paid',
        amount: body.payload.amount,
        asset: body.payload.asset,
        raw: body
      }
    },

    async checkStatus(invoiceId: string): Promise<'pending' | 'paid' | 'expired' | 'failed'> {
      const response = await callApi<CryptoPayGetInvoicesResponse>('getInvoices', {
        invoice_ids: invoiceId
      })
      const item = response.result?.items[0]
      if (!item) {
        return 'failed'
      }
      if (item.status === 'paid') return 'paid'
      if (item.status === 'expired') return 'expired'
      return 'pending'
    }
  }
}
