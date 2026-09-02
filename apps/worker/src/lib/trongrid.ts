import { loadEnv } from '../env.js'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal read-only TronGrid REST client for chain-scan. The shop never holds
// keys: customers pay into the owner's own wallet and this client only lists
// the USDT transfers that landed there. Nothing here can move funds.
// ─────────────────────────────────────────────────────────────────────────────

export interface TronTrc20Transfer {
  transaction_id: string
  token_info: { symbol: string; address: string; decimals: number }
  block_timestamp: number
  from: string
  to: string
  value: string // smallest units, decimal string
  type: 'Transfer'
}

interface TronGridTransfersResponse {
  data?: TronTrc20Transfer[]
  success: boolean
  meta?: { at?: number; fingerprint?: string }
}

/** TronGrid caps a page at 200 rows; more than that in one window is paged by fingerprint. */
const PAGE_LIMIT = 200
/** Upper bound on pages per scan so a runaway account can never stall the worker. */
const MAX_PAGES = 10

export class TronGridClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined

  constructor() {
    const env = loadEnv()
    this.baseUrl = env.TRONGRID_API_BASE.replace(/\/+$/, '')
    this.apiKey = env.TRONGRID_API_KEY || undefined
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {}
  }

  /**
   * Every TRC-20 transfer of `contractAddress` INTO `address` since
   * `minTimestampMs`, newest first, following TronGrid's fingerprint pagination.
   */
  async getTrc20TransfersTo(address: string, contractAddress: string, minTimestampMs: number): Promise<TronTrc20Transfer[]> {
    const all: TronTrc20Transfer[] = []
    let fingerprint: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${this.baseUrl}/v1/accounts/${address}/transactions/trc20`)
      url.searchParams.set('only_to', 'true')
      url.searchParams.set('only_confirmed', 'true')
      url.searchParams.set('limit', String(PAGE_LIMIT))
      url.searchParams.set('contract_address', contractAddress)
      url.searchParams.set('min_timestamp', String(Math.max(0, Math.floor(minTimestampMs))))
      if (fingerprint) url.searchParams.set('fingerprint', fingerprint)

      const res = await fetch(url.toString(), { headers: this.headers() })
      if (!res.ok) throw new Error(`TronGrid trc20 transfers HTTP ${res.status}`)
      const body = (await res.json()) as TronGridTransfersResponse
      if (!body.success) throw new Error('TronGrid trc20 transfers returned success=false')

      const rows = body.data ?? []
      // Belt and braces: the query already filters by recipient and token, but
      // a matcher that credits money must never trust a filter it did not verify.
      for (const row of rows) {
        if (row.to === address && row.token_info?.address === contractAddress && /^\d+$/.test(row.value)) all.push(row)
      }
      fingerprint = body.meta?.fingerprint
      if (!fingerprint || rows.length < PAGE_LIMIT) break
    }
    return all
  }
}

let singleton: TronGridClient | undefined

export function getTronGridClient(): TronGridClient {
  if (!singleton) singleton = new TronGridClient()
  return singleton
}
