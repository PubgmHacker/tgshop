import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { HDKey } from '@scure/bip32'
import { z } from 'zod'
import { LowTrxError, ManualSweepRequired, PaymentConfigError, PaymentProviderHttpError } from './errors.js'
import { publicKeyToTronAddress, privateKeyToTronAddress, tronAddressToHex } from './tron-address.js'
import type { SignAndBroadcastTrc20, SendTrx } from './tron-signer.js'
import type {
  CreateInvoiceInput,
  CreatedInvoice,
  PaymentProvider,
  RawWebhook,
  VerifiedEvent
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// TRON TRC-20 USDT provider.
//
// DEPOSIT ADDRESS STRATEGY (chosen): unique per-invoice deposit address,
// derived BIP-44 style at m/44'/195'/0'/0/i, where `i` is the
// DepositAddress.derivationIndex (unique per invoice/order). Address
// GENERATION derives from the account-level extended PUBLIC key
// (TRON_MASTER_XPUB), so any process (bot, worker, admin) can hand a customer
// a fresh address without touching key material.
//
// ALTERNATIVE (documented, not used): a single shared deposit address +
// requiring the customer to pay an exact, invoice-specific amount (e.g. by
// appending a few random "cents" of USDT to the plan price) to disambiguate
// which invoice a transfer belongs to. Rejected here because: (a) TRC-20
// USDT transfers only carry amount/from/to, no memo field, so amount is the
// only disambiguator and collisions are possible under concurrent invoices
// for the same price; (b) unique addresses give us a clean sweep unit and
// let us watch a bounded, known set of addresses via TronGrid instead of
// scanning all inbound transfers to one address and reconciling by amount.
//
// ─── WHY AN XPUB CANNOT SWEEP ────────────────────────────────────────────────
// Sweeping moves USDT *out of* a deposit address, which means signing a
// transaction whose `owner_address` IS that deposit address. Only the private
// key sitting at m/44'/195'/0'/0/i can produce that signature.
//
// An extended public key is, by construction, one-way: it carries the public
// point and the chain code, which is exactly enough to derive CHILD PUBLIC
// keys (and therefore addresses), and provably not enough to recover any
// private key. There is no configuration, library or endpoint that can sweep
// from an xpub — the funds would be unspendable. The hot wallet's own key
// (TRON_HOT_WALLET_KEY) does not help either: it controls a *different*
// address and has no authority over per-invoice deposit addresses.
//
// Therefore live sweeping requires the account-level extended PRIVATE key,
// supplied as TRON_MASTER_XPRV. The two keys must come from the same seed and
// the same account path; `sweep()` proves this at runtime by re-deriving the
// address from the xprv and refusing to sign unless it matches the xpub-derived
// address (and, when supplied, the address recorded in the database).
//
// KEY HANDLING:
// Both TRON_MASTER_XPRV and TRON_HOT_WALLET_KEY are stored as AES-256-GCM
// encrypted keystore blobs in the `v1:iv:tag:ct` format used elsewhere in this
// codebase (see @tgshop/core `encrypt`/`decrypt` — this module re-implements
// the same primitive locally to avoid a hard runtime dependency loop; the
// format is byte-compatible).
//
// READ-ONLY MODE: when TRON_SWEEP_READ_ONLY is true (the default) or no
// TRON_MASTER_XPRV is configured, deriveAddress/scanTransfers still work
// (they only need the xpub) but `sweep()` throws `ManualSweepRequired`. Funds
// are then moved by an operator from a separate signing environment. This is a
// supported posture, not a failure mode.
// ─────────────────────────────────────────────────────────────────────────────

// `masterXpub` (TRON_MASTER_XPUB) and `masterXprv` (TRON_MASTER_XPRV) are
// expected to already be the ACCOUNT-level extended keys at m/44'/195'/0' (as
// produced by an offline signer from the treasury's seed). We only ever derive
// the non-hardened `/0/i` tail from them here: hardened derivation requires the
// private key and must never be attempted on a process that only holds an xpub.
const DERIVATION_PATH_TAIL_PREFIX = 'm/0'
const CIPHER_ALGO = 'aes-256-gcm'
const CIPHER_VERSION = 'v1'

export const TronConfigSchema = z.object({
  masterXpub: z.string().min(1),
  tronGridApiKey: z.string().min(1),
  tronGridBaseUrl: z.string().url().default('https://api.trongrid.io'),
  usdtContractAddress: z.string().min(1).default('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  minConfirmations: z.number().int().positive().default(19),
  treasuryAddress: z.string().min(1)
})
export type TronConfig = z.infer<typeof TronConfigSchema>

export interface TronDeps {
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Raw 32-byte AES key used to decrypt TRON_HOT_WALLET_KEY / TRON_MASTER_XPRV, when present. */
  encryptionKey?: Buffer
}

// ── Address derivation ────────────────────────────────────────────────────

function assertDerivationIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new PaymentConfigError(`derivation index must be a non-negative integer, got ${index}`)
  }
}

/**
 * Derives the TRON base58check address at m/44'/195'/0'/0/index from the
 * configured master xpub. Only requires the public key — safe to run
 * without any private key material present.
 */
export function deriveAddress(masterXpub: string, index: number): string {
  assertDerivationIndex(index)
  const node = HDKey.fromExtendedKey(masterXpub)
  const child = node.derive(`${DERIVATION_PATH_TAIL_PREFIX}/${index}`)
  if (!child.publicKey) {
    throw new PaymentConfigError(`Failed to derive public key at index ${index}`)
  }
  return publicKeyToTronAddress(child.publicKey)
}

/**
 * Derives the raw 32-byte hex PRIVATE key at m/44'/195'/0'/0/index from the
 * account-level master xprv. This is the only thing that can authorise moving
 * funds out of the matching deposit address (see "WHY AN XPUB CANNOT SWEEP").
 *
 * Handle with care: the returned string is unencrypted key material. It is
 * derived on demand, used for a single signature and never persisted.
 */
export function deriveDepositPrivateKey(masterXprv: string, index: number): string {
  assertDerivationIndex(index)
  const node = HDKey.fromExtendedKey(masterXprv)
  if (!node.privateKey) {
    throw new PaymentConfigError(
      'TRON_MASTER_XPRV decrypted to a PUBLIC extended key (xpub). Sweeping needs the private half; ' +
        'an xpub can only generate deposit addresses, never spend from them.'
    )
  }
  const child = node.derive(`${DERIVATION_PATH_TAIL_PREFIX}/${index}`)
  if (!child.privateKey) {
    throw new PaymentConfigError(`Failed to derive private key at index ${index}`)
  }
  return Buffer.from(child.privateKey).toString('hex')
}

// ── Transfer scanning ──────────────────────────────────────────────────────

export interface OnChainTransfer {
  txHash: string
  toAddress: string
  fromAddress: string
  /** Amount in USDT smallest units (6 decimals), as a string. */
  amount: string
  blockNumber: number
  confirmations: number
  timestamp: Date
}

interface TronGridTrc20TxResponse {
  data: Array<{
    transaction_id: string
    token_info: { address: string; decimals: number; symbol: string }
    from: string
    to: string
    value: string
    block_timestamp: number
  }>
}

/**
 * Scans TronGrid for TRC-20 USDT transfers into any of `addresses`, since
 * `sinceBlock` (used as a cursor / min_timestamp proxy). Confirmations are
 * computed against the current chain head fetched from TronGrid.
 */
export async function scanTransfers(
  config: TronConfig,
  addresses: string[],
  sinceBlock: number,
  deps: TronDeps = {}
): Promise<OnChainTransfer[]> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const headBlock = await getCurrentBlockNumber(config, fetchImpl)

  const results: OnChainTransfer[] = []
  for (const address of addresses) {
    const url = new URL(`${config.tronGridBaseUrl}/v1/accounts/${address}/transactions/trc20`)
    url.searchParams.set('contract_address', config.usdtContractAddress)
    url.searchParams.set('only_to', 'true')
    url.searchParams.set('limit', '50')
    url.searchParams.set('min_block_timestamp', String(sinceBlock))

    const res = await fetchImpl(url.toString(), {
      headers: { 'TRON-PRO-API-KEY': config.tronGridApiKey }
    })
    if (!res.ok) {
      throw new PaymentProviderHttpError('TronGrid transfer scan failed', res.status, await res.text())
    }
    const json = (await res.json()) as TronGridTrc20TxResponse
    for (const tx of json.data) {
      if (tx.token_info.address !== config.usdtContractAddress) continue
      if (tx.to !== address) continue
      const txBlockEstimate = Math.floor(tx.block_timestamp / 1000)
      results.push({
        txHash: tx.transaction_id,
        toAddress: tx.to,
        fromAddress: tx.from,
        amount: tx.value,
        blockNumber: txBlockEstimate,
        confirmations: Math.max(0, headBlock - txBlockEstimate),
        timestamp: new Date(tx.block_timestamp)
      })
    }
  }
  return results
}

async function getCurrentBlockNumber(config: TronConfig, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(`${config.tronGridBaseUrl}/wallet/getnowblock`, {
    method: 'POST',
    headers: { 'TRON-PRO-API-KEY': config.tronGridApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  if (!res.ok) {
    throw new PaymentProviderHttpError('TronGrid getnowblock failed', res.status, await res.text())
  }
  const json = (await res.json()) as { block_header: { raw_data: { number: number } } }
  return json.block_header.raw_data.number
}

/** Classification of a received transfer relative to the expected invoice amount. */
export type PaymentMatchClassification = 'exact' | 'underpaid' | 'overpaid'

export function classifyTransferAmount(
  receivedAmount: bigint,
  expectedAmount: bigint
): PaymentMatchClassification {
  if (receivedAmount === expectedAmount) return 'exact'
  if (receivedAmount < expectedAmount) return 'underpaid'
  return 'overpaid'
}

export function isConfirmed(confirmations: number, config: TronConfig): boolean {
  return confirmations >= config.minConfirmations
}

/** TRON produces one block every 3 seconds (SR schedule); used to age transfers into confirmations. */
export const TRON_BLOCK_INTERVAL_MS = 3_000

export interface InboundTransferAge {
  /** USDT smallest units (6 decimals). */
  amount: bigint
  /** Block timestamp in epoch milliseconds, as reported by TronGrid. */
  blockTimestampMs: number
}

/**
 * Sums the inbound USDT that has NOT yet reached `minConfirmations`.
 *
 * We age transfers by wall-clock against TRON's fixed 3s block interval rather
 * than fetching each transaction's block height, which would cost one HTTP
 * round trip per transfer. The approximation is deliberately biased safe: a
 * clock skew or a slow block makes a transfer look YOUNGER (still
 * unconfirmed), which only ever *delays* a sweep. It can never mark a genuinely
 * unconfirmed deposit as confirmed, which is the direction that would lose
 * money to a reorg.
 */
export function sumUnconfirmedInbound(
  transfers: readonly InboundTransferAge[],
  nowMs: number,
  minConfirmations: number
): bigint {
  const minAgeMs = minConfirmations * TRON_BLOCK_INTERVAL_MS
  let total = 0n
  for (const transfer of transfers) {
    if (nowMs - transfer.blockTimestampMs < minAgeMs) {
      total += transfer.amount
    }
  }
  return total
}

// ── Encrypted key material ─────────────────────────────────────────────────

/**
 * Decrypts a `v1:iv:tag:ct` AES-256-GCM keystore blob. Returns null when the
 * blob is absent, which callers treat as "this capability is not provisioned"
 * (read-only mode) rather than an error.
 */
function loadEncryptedSecret(
  encryptedKeystore: string | undefined,
  encryptionKey: Buffer | undefined,
  label: string
): string | null {
  if (!encryptedKeystore) {
    return null
  }
  if (!encryptionKey) {
    throw new PaymentConfigError(`${label} is set but no AES encryption key was provided to decrypt it`)
  }
  const parts = encryptedKeystore.split(':')
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new PaymentConfigError(`${label} is not a valid v1 encrypted keystore blob`)
  }
  const [, ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64 as string, 'base64')
  const tag = Buffer.from(tagB64 as string, 'base64')
  const ciphertext = Buffer.from(ctB64 as string, 'base64')
  const decipher = createDecipheriv(CIPHER_ALGO, encryptionKey, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Decrypts TRON_HOT_WALLET_KEY into the raw hex private key. Returns null when
 * TRON_HOT_WALLET_KEY is unset — the hot wallet only funds energy top-ups, so
 * its absence degrades to `LowTrxError` rather than blocking every sweep.
 */
export function loadHotWalletPrivateKey(
  encryptedKeystore: string | undefined,
  encryptionKey: Buffer | undefined
): string | null {
  return loadEncryptedSecret(encryptedKeystore, encryptionKey, 'TRON_HOT_WALLET_KEY')
}

/**
 * Decrypts TRON_MASTER_XPRV into the account-level extended private key.
 * Returns null when unset, which puts `sweep()` in read-only mode.
 */
export function loadMasterXprv(
  encryptedKeystore: string | undefined,
  encryptionKey: Buffer | undefined
): string | null {
  return loadEncryptedSecret(encryptedKeystore, encryptionKey, 'TRON_MASTER_XPRV')
}

/** Encrypts a secret (raw hex private key or xprv) into the `v1:iv:tag:ct` keystore format for storage. */
export function encryptHotWalletKey(rawSecret: string, encryptionKey: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(CIPHER_ALGO, encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(rawSecret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${CIPHER_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

// ── Energy / bandwidth policy ──────────────────────────────────────────────

export interface EnergyPolicy {
  /** TRX (SUN) a deposit address must hold before we attempt a TRC-20 transfer out of it. */
  reserveSun: bigint
  /** TRX (SUN) the hot wallet sends to a deposit address that is below `reserveSun`. */
  topUpSun: bigint
  /** TRX (SUN) the hot wallet must still hold AFTER funding a top-up, or we refuse to spend. */
  hotWalletFloorSun: bigint
  /** Hard cap (SUN) on TRX burnt for energy by the sweep transfer itself. */
  feeLimitSun: bigint
  /** How long to wait for a top-up to land before giving up. */
  topUpTimeoutMs: number
  /** Poll interval while waiting for a top-up to land. */
  topUpPollIntervalMs: number
}

/**
 * Defaults sized from real TRC-20 USDT costs (all values in SUN, 1 TRX = 1e6 SUN):
 *
 *   • A USDT transfer to a recipient that ALREADY holds USDT burns ~32k energy;
 *     to a fresh recipient (a zero-balance slot in the token contract) ~65k.
 *     Sweeps always target the same treasury address, so after the first sweep
 *     they take the cheap path — but the first one must be affordable too.
 *   • Energy costs 420 SUN/unit since the 2024 network parameter change, so the
 *     worst case is ~65k * 420 = 27.3 TRX. Bandwidth adds ~345 bytes; a fresh
 *     deposit address has a small free allowance and otherwise pays ~0.35 TRX.
 *
 * reserveSun 27 TRX therefore covers the expensive path, and topUpSun 30 TRX
 * adds headroom for bandwidth plus drift in the energy price. feeLimitSun is
 * set above both so a legitimate transfer is never truncated, while still
 * bounding the damage from a misconfigured contract address.
 *
 * These are conservative on purpose: an under-funded address burns the fee and
 * reverts with OUT_OF_ENERGY, which costs money and sweeps nothing.
 */
export const DEFAULT_ENERGY_POLICY: EnergyPolicy = {
  reserveSun: 27_000_000n,
  topUpSun: 30_000_000n,
  hotWalletFloorSun: 50_000_000n,
  feeLimitSun: 40_000_000n,
  topUpTimeoutMs: 90_000,
  topUpPollIntervalMs: 3_000
}

// ── Sweeping ───────────────────────────────────────────────────────────────

/**
 * Persistence port for sweep bookkeeping. Implemented by the worker against
 * the DepositAddress table; faked in tests.
 *
 * The claim/commit/release split exists because a sweep spans several
 * un-rollback-able chain calls, so the guard against a concurrent second sweep
 * has to be taken BEFORE broadcasting and surrendered only if we never got a
 * transaction out.
 */
export interface SweepLedger {
  /**
   * Atomically claims `address` for sweeping. Must return false — not throw —
   * when another worker already holds the claim.
   */
  claim: (address: string) => Promise<boolean>
  /** Surrenders a claim that produced no broadcast, so a later run can retry. */
  release: (address: string) => Promise<void>
  /** Records a successful, complete sweep. The claim stays held: the address is drained and retired. */
  commit: (params: { address: string; txHash: string; amountSwept: bigint }) => Promise<void>
}

export interface SweepRequest {
  /** DepositAddress.derivationIndex — selects the key at m/44'/195'/0'/0/<index>. */
  derivationIndex: number
  /** Treasury address that receives the funds. */
  toAddress: string
  /** DepositAddress.address as recorded in the DB; cross-checked against derivation when supplied. */
  expectedAddress?: string
  /** Encrypted TRON_MASTER_XPRV. Absent => read-only mode. */
  encryptedMasterXprv?: string
  /** Encrypted TRON_HOT_WALLET_KEY, used only to fund energy top-ups. */
  encryptedHotWalletKey?: string
  /** When true, refuse to sign no matter what key material is present. */
  readOnly: boolean
  /** Minimum sweepable balance (USDT 6dp) that justifies paying for energy. */
  thresholdUsdt6: bigint
  energy?: Partial<EnergyPolicy>
}

export interface SweepDeps extends TronDeps {
  /** Native TRX balance in SUN for any address. */
  getTrxBalanceSun: (address: string) => Promise<bigint>
  /** Current TRC-20 balance (USDT 6dp) held by `address`, read from the token contract. */
  getUsdtBalance: (address: string) => Promise<bigint>
  /** USDT (6dp) received by `address` in transfers that have not yet reached minConfirmations. */
  getUnconfirmedInboundUsdt: (address: string) => Promise<bigint>
  signAndBroadcast: SignAndBroadcastTrc20
  sendTrx: SendTrx
  ledger: SweepLedger
  sleep?: (ms: number) => Promise<void>
}

export interface SweepResult {
  fromAddress: string
  txHash: string
  /** USDT 6dp, as a string (never a float). */
  amountSwept: string
  /** Hash of the TRX top-up that funded energy, when one was needed. */
  topUpTxHash: string | null
}

export type SweepSkipReason = 'below_threshold' | 'already_claimed' | 'unconfirmed_pending'

export type SweepOutcome =
  | ({ status: 'swept' } & SweepResult)
  | {
      status: 'skipped'
      fromAddress: string
      reason: SweepSkipReason
      /** USDT 6dp that *would* have been swept, as a string. */
      sweepableAmount: string
    }

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sweeps confirmed USDT from the deposit address at `derivationIndex` to
 * `toAddress`.
 *
 * Throws `ManualSweepRequired` in read-only mode, and `LowTrxError` when
 * neither the deposit address nor the hot wallet can pay for the transfer's
 * energy.
 */
export async function sweep(
  config: TronConfig,
  request: SweepRequest,
  deps: SweepDeps
): Promise<SweepOutcome> {
  const policy: EnergyPolicy = { ...DEFAULT_ENERGY_POLICY, ...request.energy }
  const sleep = deps.sleep ?? defaultSleep
  const nowMs = (): number => (deps.now ? deps.now().getTime() : Date.now())

  const fromAddress = deriveAddress(config.masterXpub, request.derivationIndex)
  if (request.expectedAddress && request.expectedAddress !== fromAddress) {
    // The DB row and the xpub disagree about which address index `i` owns.
    // Signing anyway would move funds using a key for a different address, so
    // stop before any key material is touched.
    throw new PaymentConfigError(
      `Deposit address mismatch at index ${request.derivationIndex}: database has ` +
        `${request.expectedAddress} but TRON_MASTER_XPUB derives ${fromAddress}`
    )
  }

  // Pre-flight the destination while failing is still free. Address encoding
  // happens inside signAndBroadcast, i.e. after the claim is taken, and a
  // typo'd treasury address would otherwise strand every deposit address in
  // the batch behind a held claim on the very first run.
  tronAddressToHex(request.toAddress)

  // ── How much is actually safe to move ───────────────────────────────────
  // `balanceOf` is the authoritative on-chain balance, but it includes
  // transfers from blocks that are only seconds old and could still be
  // reorganised away.
  //
  // We deliberately sweep ALL-OR-NOTHING: if any inbound deposit is still
  // maturing, we skip this address entirely and revisit it next round rather
  // than moving the confirmed part now. Sweeping a partial amount would force
  // us to leave the address claimable again, and the follow-up run could read
  // a `balanceOf` that has not yet caught up with our own in-flight transfer —
  // broadcasting a second transfer for funds already on their way out. Deposits
  // mature in ~19 blocks (about a minute), far below the sweep cadence, so
  // waiting costs nothing and removes that race completely.
  const tokenBalance = await deps.getUsdtBalance(fromAddress)
  const unconfirmedInbound = await deps.getUnconfirmedInboundUsdt(fromAddress)

  const masterXprv = loadMasterXprv(request.encryptedMasterXprv, deps.encryptionKey)
  if (request.readOnly || !masterXprv) {
    throw new ManualSweepRequired(fromAddress, tokenBalance)
  }

  if (unconfirmedInbound > 0n) {
    return {
      status: 'skipped',
      fromAddress,
      reason: 'unconfirmed_pending',
      sweepableAmount: '0'
    }
  }

  const sweepable = tokenBalance
  if (sweepable < request.thresholdUsdt6 || sweepable === 0n) {
    return {
      status: 'skipped',
      fromAddress,
      reason: 'below_threshold',
      sweepableAmount: sweepable.toString()
    }
  }

  // ── Concurrency guard ────────────────────────────────────────────────────
  // Taken before ANY chain write. Everything after this point is inside the
  // claim, and the claim is only surrendered if we provably did not broadcast.
  const claimed = await deps.ledger.claim(fromAddress)
  if (!claimed) {
    return {
      status: 'skipped',
      fromAddress,
      reason: 'already_claimed',
      sweepableAmount: sweepable.toString()
    }
  }

  let broadcast = false
  try {
    const privateKeyHex = deriveDepositPrivateKey(masterXprv, request.derivationIndex)
    // Proof that the xprv and the xpub come from the same seed/account. A
    // mismatch means the operator pasted keys from different wallets; signing
    // would produce a transaction whose signature does not match its
    // owner_address and burn the fee for nothing.
    const derivedFromPrivate = privateKeyToTronAddress(privateKeyHex)
    if (derivedFromPrivate !== fromAddress) {
      throw new PaymentConfigError(
        `TRON_MASTER_XPRV does not match TRON_MASTER_XPUB at index ${request.derivationIndex}: ` +
          `xprv derives ${derivedFromPrivate}, xpub derives ${fromAddress}`
      )
    }

    const topUpTxHash = await ensureEnergy(fromAddress, request, policy, deps, sleep, nowMs)

    broadcast = true
    const txHash = await deps.signAndBroadcast({
      fromAddress,
      privateKeyHex,
      toAddress: request.toAddress,
      amount: sweepable,
      contractAddress: config.usdtContractAddress,
      feeLimitSun: policy.feeLimitSun
    })

    await deps.ledger.commit({ address: fromAddress, txHash, amountSwept: sweepable })

    return {
      status: 'swept',
      fromAddress,
      txHash,
      amountSwept: sweepable.toString(),
      topUpTxHash
    }
  } catch (err) {
    // Only surrender the claim when we are certain nothing was broadcast.
    // If the failure happened at or after the broadcast call we cannot know
    // whether the transaction reached the network, so the claim STAYS held:
    // stranding funds behind an operator's manual review is recoverable,
    // double-spending them is not.
    if (!broadcast) {
      await deps.ledger.release(fromAddress)
    }
    throw err
  }
}

/**
 * Makes sure `fromAddress` can pay for its own TRC-20 transfer, topping it up
 * from the hot wallet when it cannot. Returns the top-up tx hash, or null when
 * no top-up was needed.
 *
 * A freshly created deposit address holds zero TRX, and TRC-20 transfers are
 * paid for by the SENDER — so without this step every first sweep would fail.
 */
async function ensureEnergy(
  fromAddress: string,
  request: SweepRequest,
  policy: EnergyPolicy,
  deps: SweepDeps,
  sleep: (ms: number) => Promise<void>,
  nowMs: () => number
): Promise<string | null> {
  const trxBalance = await deps.getTrxBalanceSun(fromAddress)
  if (trxBalance >= policy.reserveSun) {
    return null
  }

  const hotWalletKey = loadHotWalletPrivateKey(request.encryptedHotWalletKey, deps.encryptionKey)
  if (!hotWalletKey) {
    throw new LowTrxError(fromAddress, policy.reserveSun - trxBalance)
  }
  const hotWalletAddress = privateKeyToTronAddress(hotWalletKey)
  const hotWalletBalance = await deps.getTrxBalanceSun(hotWalletAddress)

  // Refuse to drain the hot wallet below its floor. Burning the last of its TRX
  // on one top-up would leave every subsequent sweep stuck with no way to fund
  // itself, so we stop early and let the low_trx alert bring an operator in.
  const required = policy.topUpSun + policy.hotWalletFloorSun
  if (hotWalletBalance < required) {
    throw new LowTrxError(hotWalletAddress, required - hotWalletBalance)
  }

  const topUpTxHash = await deps.sendTrx({
    fromAddress: hotWalletAddress,
    privateKeyHex: hotWalletKey,
    toAddress: fromAddress,
    amountSun: policy.topUpSun
  })

  // Wait for the TRX to actually land. We poll the balance rather than the
  // transaction receipt because the balance is the precondition we care about,
  // and it stays correct even if the top-up was funded by something else.
  const startedAt = nowMs()
  for (;;) {
    const balance = await deps.getTrxBalanceSun(fromAddress)
    if (balance >= policy.reserveSun) {
      return topUpTxHash
    }
    if (nowMs() - startedAt >= policy.topUpTimeoutMs) {
      throw new LowTrxError(fromAddress, policy.reserveSun - balance)
    }
    await sleep(policy.topUpPollIntervalMs)
  }
}

// ── PaymentProvider adapter ────────────────────────────────────────────────

export interface TronProviderState {
  /** Persists/loads the next unused derivation index; provided by the caller (backed by DepositAddress table). */
  allocateDerivationIndex: () => Promise<number>
  /** Persists the created DepositAddress row so scanTransfers() knows which addresses to watch. */
  saveDepositAddress: (params: { orderId: string; address: string; derivationIndex: number }) => Promise<void>
  /** Looks up the expected amount (USDT 6-decimals string) + confirmed transfer, if any, for a given invoiceId (= address). */
  lookupInvoiceState: (invoiceId: string) => Promise<{
    expectedAmount: string
    transfer: OnChainTransfer | null
  } | null>
}

export function createTronProvider(
  config: TronConfig,
  state: TronProviderState,
  deps: TronDeps = {}
): PaymentProvider {
  const now = deps.now ?? (() => new Date())

  return {
    id: 'tron_trc20',

    async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
      const index = await state.allocateDerivationIndex()
      const address = deriveAddress(config.masterXpub, index)
      await state.saveDepositAddress({ orderId: input.orderId, address, derivationIndex: index })

      // amountCents (USD) -> USDT6 assumed 1:1 peg unless the caller passes a
      // pre-converted amount; conversion belongs to the pricing/oracle layer
      // (see oracle.ts) so this adapter stays provider-shaped, not USD-shaped.
      const usdt6 = BigInt(input.amountCents) * 10_000n // 1 cent = 0.01 USD = 10_000 USDT6 at 1:1 peg
      const expiresAt = new Date(now().getTime() + 30 * 60 * 1000)
      return {
        invoiceId: address,
        address,
        amount: usdt6.toString(),
        asset: 'USDT',
        expiresAt
      }
    },

    async verifyWebhook(_raw: RawWebhook): Promise<VerifiedEvent | null> {
      // TRON has no push webhook in this design — settlement is detected by
      // polling scanTransfers()/checkStatus() against watched addresses.
      // This method is a no-op that always returns null; kept to satisfy the
      // common PaymentProvider interface.
      return null
    },

    async checkStatus(invoiceId: string): Promise<'pending' | 'paid' | 'expired' | 'failed'> {
      const invoiceState = await state.lookupInvoiceState(invoiceId)
      if (!invoiceState) {
        return 'failed'
      }
      const { transfer } = invoiceState
      if (!transfer) {
        return 'pending'
      }
      if (!isConfirmed(transfer.confirmations, config)) {
        return 'pending'
      }
      const classification = classifyTransferAmount(BigInt(transfer.amount), BigInt(invoiceState.expectedAmount))
      if (classification === 'underpaid') {
        return 'failed'
      }
      return 'paid'
    }
  }
}
