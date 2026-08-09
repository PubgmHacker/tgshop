import { loadEnv } from '../env.js'
import { logger } from '../logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal CryptoBot (@CryptoBot Pay API) client used by payments:poll to
// fall back onto polling `getInvoices` for orders whose webhook may have
// been missed.
// ─────────────────────────────────────────────────────────────────────────────

export interface CryptoBotInvoice {
  invoice_id: number
  status: 'active' | 'paid' | 'expired'
  hash: string
  asset: string
  amount: string
  paid_asset?: string
  paid_amount?: string
  paid_at?: string
}

interface CryptoBotResponse<T> {
  ok: boolean
  result?: T
  error?: { code: number; name: string }
}

export class CryptoBotClient {
  private readonly token: string
  private readonly baseUrl: string

  constructor() {
    const env = loadEnv()
    if (!env.CRYPTOBOT_API_TOKEN) {
      throw new Error('CRYPTOBOT_API_TOKEN is not set; cannot use CryptoBotClient')
    }
    this.token = env.CRYPTOBOT_API_TOKEN
    this.baseUrl = env.CRYPTOBOT_API_BASE
  }

  async getInvoices(invoiceIds: string[]): Promise<CryptoBotInvoice[]> {
    if (invoiceIds.length === 0) return []
    const url = new URL(`${this.baseUrl}/getInvoices`)
    url.searchParams.set('invoice_ids', invoiceIds.join(','))
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Crypto-Pay-API-Token': this.token }
    })
    if (!res.ok) {
      throw new Error(`CryptoBot getInvoices HTTP ${res.status}`)
    }
    const body = (await res.json()) as CryptoBotResponse<{ items: CryptoBotInvoice[] }>
    if (!body.ok || !body.result) {
      logger.error({ body }, 'CryptoBot getInvoices returned error')
      throw new Error(`CryptoBot getInvoices failed: ${body.error?.name ?? 'unknown error'}`)
    }
    return body.result.items
  }
}

let singleton: CryptoBotClient | undefined

export function getCryptoBotClient(): CryptoBotClient | null {
  const env = loadEnv()
  if (!env.CRYPTOBOT_API_TOKEN) return null
  if (!singleton) singleton = new CryptoBotClient()
  return singleton
}
