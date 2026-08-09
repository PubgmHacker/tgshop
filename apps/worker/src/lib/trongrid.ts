import { tronAddressToHex } from '@tgshop/payments'
import { loadEnv } from '../env.js'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal TronGrid REST client for chain:scan / chain:sweep. Only the calls
// the worker needs: TRC-20 transfer history for an address, TRC-20 and TRX
// balances, and chain tip block number for confirmation math. Building and
// signing sweep transactions is delegated to @tgshop/payments, which owns the
// HD key material; this client only reads chain state.
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
  data: TronTrc20Transfer[]
  success: boolean
  meta: { at: number; fingerprint?: string }
}

export class TronGridClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined

  constructor() {
    const env = loadEnv()
    this.baseUrl = env.TRONGRID_API_BASE
    this.apiKey = env.TRONGRID_API_KEY
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {}
  }

  /** Fetches TRC-20 transfers TO `address` for `contractAddress`, most recent first, since minTimestampMs if given. */
  async getTrc20TransfersTo(
    address: string,
    contractAddress: string,
    minTimestampMs?: number
  ): Promise<TronTrc20Transfer[]> {
    const url = new URL(`${this.baseUrl}/v1/accounts/${address}/transactions/trc20`)
    url.searchParams.set('only_to', 'true')
    url.searchParams.set('limit', '100')
    url.searchParams.set('contract_address', contractAddress)
    if (minTimestampMs) {
      url.searchParams.set('min_timestamp', String(minTimestampMs))
    }
    const res = await fetch(url.toString(), { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`TronGrid getTrc20TransfersTo HTTP ${res.status} for ${address}`)
    }
    const body = (await res.json()) as TronGridTransfersResponse
    if (!body.success) {
      throw new Error(`TronGrid getTrc20TransfersTo returned success=false for ${address}`)
    }
    return body.data
  }

  /** Returns the current chain tip block number, used to compute confirmations. */
  async getLatestBlockNumber(): Promise<number> {
    const url = new URL(`${this.baseUrl}/wallet/getnowblock`)
    const res = await fetch(url.toString(), { method: 'POST', headers: this.headers() })
    if (!res.ok) {
      throw new Error(`TronGrid getnowblock HTTP ${res.status}`)
    }
    const body = (await res.json()) as { block_header: { raw_data: { number: number } } }
    return body.block_header.raw_data.number
  }

  /** Returns TRX balance in sun (1 TRX = 1_000_000 sun) for the given base58 address. */
  async getTrxBalanceSun(address: string): Promise<bigint> {
    const url = new URL(`${this.baseUrl}/v1/accounts/${address}`)
    const res = await fetch(url.toString(), { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`TronGrid getTrxBalanceSun HTTP ${res.status} for ${address}`)
    }
    const body = (await res.json()) as { data?: Array<{ balance?: number }> }
    const balance = body.data?.[0]?.balance ?? 0
    return BigInt(balance)
  }

  /**
   * Reads the live TRC-20 balance of `address` by calling `balanceOf(address)`
   * on the token contract.
   *
   * We use the contract's own view function rather than the indexed `trc20`
   * field of /v1/accounts, because the indexer can lag behind the chain tip by
   * seconds-to-minutes. Sweeping decides how much money to move, so it must
   * read the authoritative state a full node computes from the latest block.
   *
   * `triggerconstantcontract` executes locally on the node and costs no energy.
   */
  async getTrc20Balance(address: string, contractAddress: string): Promise<bigint> {
    const ownerHex = tronAddressToHex(address)
    const url = new URL(`${this.baseUrl}/wallet/triggerconstantcontract`)
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_address: ownerHex,
        contract_address: tronAddressToHex(contractAddress),
        function_selector: 'balanceOf(address)',
        // Single ABI word: the 20-byte account id (0x41 version byte stripped)
        // left-padded to 32 bytes.
        parameter: ownerHex.slice(2).padStart(64, '0'),
        visible: false
      })
    })
    if (!res.ok) {
      throw new Error(`TronGrid getTrc20Balance HTTP ${res.status} for ${address}`)
    }
    const body = (await res.json()) as {
      result?: { result?: boolean; message?: string }
      constant_result?: string[]
    }
    if (body.result?.result !== true) {
      throw new Error(`TronGrid balanceOf failed for ${address}: ${body.result?.message ?? 'unknown error'}`)
    }
    const word = body.constant_result?.[0]
    if (!word || !/^[0-9a-fA-F]+$/.test(word)) {
      throw new Error(`TronGrid balanceOf returned no readable result for ${address}`)
    }
    // uint256 big-endian hex -> BigInt. No float ever touches the amount.
    return BigInt(`0x${word}`)
  }

  /** Broadcasts an already-signed raw transaction (used by chain:sweep). Returns the resulting tx hash. */
  async broadcastTransaction(signedTx: unknown): Promise<{ result: boolean; txid?: string; message?: string }> {
    const url = new URL(`${this.baseUrl}/wallet/broadcasttransaction`)
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(signedTx)
    })
    if (!res.ok) {
      throw new Error(`TronGrid broadcasttransaction HTTP ${res.status}`)
    }
    return (await res.json()) as { result: boolean; txid?: string; message?: string }
  }
}

let singleton: TronGridClient | undefined

export function getTronGridClient(): TronGridClient {
  if (!singleton) singleton = new TronGridClient()
  return singleton
}
