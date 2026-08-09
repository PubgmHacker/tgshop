import type { Redis } from 'ioredis'
import { StalePriceError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Price oracle: fetches USD prices for on-chain/Stars assets.
//
// Default backend: CoinGecko simple price API, base URL overridable via
// PRICE_ORACLE_URL env (e.g. to point at a self-hosted proxy/mirror).
// Results are cached in Redis for 60s to avoid hammering the upstream API on
// every invoice/webhook. A manual override can be stored in the `Setting`
// table (key: `price_override:<asset>`) — checked before any network call,
// so ops can pin a price during upstream outages or disputes.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PRICE_ORACLE_URL = 'https://api.coingecko.com/api/v3/simple/price'
const CACHE_TTL_SECONDS = 60
/** A cached/override price older than this is considered too stale to trust for a live payment. */
const MAX_PRICE_AGE_MS = 10 * 60 * 1000

const COINGECKO_IDS: Record<string, string> = {
  USDT: 'tether',
  TON: 'the-open-network',
  BTC: 'bitcoin',
  TRX: 'tron'
}

export interface PriceOracleDeps {
  redis: Redis
  fetchImpl?: typeof fetch
  /**
   * Reads a manual override, e.g. from the `Setting` table via @tgshop/db:
   * `prisma.setting.findUnique({ where: { key: `price_override:${asset}` } })`.
   * Returning null means "no override, use live price".
   */
  getManualOverride?: (asset: string) => Promise<{ usdPrice: string; setAt: Date } | null>
  now?: () => Date
}

export interface AssetUsdPrice {
  asset: string
  /** USD price per 1 unit of asset, as a decimal string (no floats). */
  usdPrice: string
  source: 'live' | 'cache' | 'override'
  asOf: Date
}

function cacheKey(asset: string): string {
  return `payments:price:${asset.toUpperCase()}`
}

/**
 * Resolves the USD price of `asset`, checking manual override, then Redis
 * cache, then the live oracle (CoinGecko by default). Throws StalePriceError
 * if the only price we have available is older than MAX_PRICE_AGE_MS.
 */
export async function getUsdPrice(asset: string, deps: PriceOracleDeps): Promise<AssetUsdPrice> {
  const now = deps.now ?? (() => new Date())
  const upperAsset = asset.toUpperCase()

  if (deps.getManualOverride) {
    const override = await deps.getManualOverride(upperAsset)
    if (override) {
      const ageMs = now().getTime() - override.setAt.getTime()
      if (ageMs > MAX_PRICE_AGE_MS) {
        throw new StalePriceError(
          `Manual price override for ${upperAsset} is stale (${Math.round(ageMs / 1000)}s old, max ${
            MAX_PRICE_AGE_MS / 1000
          }s)`
        )
      }
      return { asset: upperAsset, usdPrice: override.usdPrice, source: 'override', asOf: override.setAt }
    }
  }

  const key = cacheKey(upperAsset)
  const cached = await deps.redis.get(key)
  if (cached) {
    const parsed = JSON.parse(cached) as { usdPrice: string; asOf: string }
    return { asset: upperAsset, usdPrice: parsed.usdPrice, source: 'cache', asOf: new Date(parsed.asOf) }
  }

  const price = await fetchLivePrice(upperAsset, deps.fetchImpl ?? fetch)
  const asOf = now()
  await deps.redis.set(
    key,
    JSON.stringify({ usdPrice: price, asOf: asOf.toISOString() }),
    'EX',
    CACHE_TTL_SECONDS
  )
  return { asset: upperAsset, usdPrice: price, source: 'live', asOf }
}

async function fetchLivePrice(asset: string, fetchImpl: typeof fetch): Promise<string> {
  const coingeckoId = COINGECKO_IDS[asset]
  if (!coingeckoId) {
    throw new StalePriceError(`No price oracle mapping configured for asset "${asset}"`)
  }
  const baseUrl = process.env.PRICE_ORACLE_URL ?? DEFAULT_PRICE_ORACLE_URL
  const url = new URL(baseUrl)
  url.searchParams.set('ids', coingeckoId)
  url.searchParams.set('vs_currencies', 'usd')

  const res = await fetchImpl(url.toString(), { method: 'GET' })
  if (!res.ok) {
    throw new StalePriceError(`Price oracle request failed with status ${res.status} for asset ${asset}`)
  }
  const body = (await res.json()) as Record<string, { usd?: number }>
  const usd = body[coingeckoId]?.usd
  if (usd === undefined || usd === null || !Number.isFinite(usd)) {
    throw new StalePriceError(`Price oracle returned no USD price for asset ${asset}`)
  }
  // Stringify with limited precision to avoid float noise leaking into stored data.
  return usd.toFixed(8)
}
