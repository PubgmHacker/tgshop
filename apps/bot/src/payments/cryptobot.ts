import { createHash, createHmac } from 'node:crypto'
import { safeEqual } from '@tgshop/core'
import { env } from '../config/env.js'

const CRYPTOBOT_API_BASE =
  env.CRYPTOBOT_NETWORK === 'mainnet' ? 'https://pay.crypt.bot/api' : 'https://testnet-pay.crypt.bot/api'

export interface CreateCryptoBotInvoiceInput {
  amountUsd: string // decimal string, e.g. "12.99"
  description: string
  payload: string // opaque string we get back on webhook, e.g. orderId
}

export interface CryptoBotInvoice {
  invoiceId: string
  payUrl: string
}

interface CryptoBotApiResponse<T> {
  ok: boolean
  result?: T
  error?: { code: number; name: string }
}

/** Creates an invoice via the CryptoBot Pay API (fiat-denominated, settled in the user's chosen crypto). */
export async function createCryptoBotInvoice(input: CreateCryptoBotInvoiceInput): Promise<CryptoBotInvoice> {
  const response = await fetch(`${CRYPTOBOT_API_BASE}/createInvoice`, {
    method: 'POST',
    headers: {
      'Crypto-Pay-API-Token': env.CRYPTOBOT_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      currency_type: 'fiat',
      fiat: 'USD',
      amount: input.amountUsd,
      description: input.description,
      payload: input.payload,
      allow_comments: false,
      allow_anonymous: false
    })
  })

  const json = (await response.json()) as CryptoBotApiResponse<{
    invoice_id: number
    pay_url: string
  }>

  if (!json.ok || !json.result) {
    throw new Error(`CryptoBot createInvoice failed: ${json.error?.name ?? 'unknown error'}`)
  }

  return { invoiceId: String(json.result.invoice_id), payUrl: json.result.pay_url }
}

/**
 * Verifies the `Crypto-Pay-API-Signature` header on a CryptoBot webhook.
 * Signature = HMAC-SHA256(sha256(apiToken), rawBody) per CryptoBot docs.
 */
export function verifyCryptoBotSignature(rawBody: string, signatureHex: string): boolean {
  // CryptoBot spec: secret = SHA256(apiToken); signature = HMAC-SHA256(secret, rawBody), hex-encoded.
  const secret = createHash('sha256').update(env.CRYPTOBOT_API_TOKEN).digest()
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(computed, signatureHex)
}
