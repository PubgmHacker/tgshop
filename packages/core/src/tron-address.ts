// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers around the single USDT-TRC20 receive address.
//
// Lives in core because BOTH the bot (issuing invoices) and the worker (reading
// the wallet on TronGrid) must agree on what a usable address is, and neither
// may drag live connections into the module graph to answer "is TRON
// configured?" — the unit tests mock env and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

/** Base58Check TRON address: 'T' + 33 chars, no 0/O/I/l. */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

export function isTronAddress(value: string | undefined | null): value is string {
  return typeof value === 'string' && TRON_ADDRESS_RE.test(value.trim())
}

export interface TronReceiveEnv {
  TRON_RECEIVE_ADDRESS?: string
  TRON_SWEEP_TO_ADDRESS?: string
}

/**
 * The owner's wallet every customer pays into. TRON_RECEIVE_ADDRESS wins; the
 * legacy TRON_SWEEP_TO_ADDRESS (where the retired hot-wallet sweep used to
 * drain funds) is accepted as a fallback so existing deployments keep working
 * without touching their variables. Returns null unless the value is a
 * well-formed T-address — a typo here would send real money nowhere.
 */
export function resolveTronReceiveAddress(env: TronReceiveEnv): string | null {
  for (const candidate of [env.TRON_RECEIVE_ADDRESS, env.TRON_SWEEP_TO_ADDRESS]) {
    const trimmed = candidate?.trim()
    if (trimmed && TRON_ADDRESS_RE.test(trimmed)) return trimmed
  }
  return null
}
