// ─────────────────────────────────────────────────────────────────────────────
// @tgshop/payments public types
//
// One `PaymentProvider` interface, two adapters (cryptobot, stars).
// Adding a new provider requires only: a new adapter file implementing this
// interface + registering it in registry.ts + a corresponding `Setting` row
// for its config (see registry.ts `ProviderConfigSchemas`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifiers for the built-in adapters. New providers extend this union.
 * The USDT-TRC20 rail is not an adapter: it is a static receive wallet the
 * worker watches (apps/worker chain-scan) and the bot tags amounts for.
 */
export type PaymentProviderId = 'cryptobot' | 'stars'

/** Input to createInvoice — always integer amounts, never floats. */
export interface CreateInvoiceInput {
  orderId: string
  userId: string
  /** Order amount in USD cents (Int). Converted internally per-provider. */
  amountCents: number
  description: string
}

/** Result of creating an invoice/deposit request with a provider. */
export interface CreatedInvoice {
  /** Provider-specific invoice/charge identifier. */
  invoiceId: string
  /** Hosted checkout URL, when the provider has one (e.g. CryptoBot mini-app link). */
  payUrl?: string
  /** Deposit address, for address-based flows (e.g. TRON). */
  address?: string
  /**
   * Amount to be paid, in the SMALLEST unit of `asset`, expressed as a string
   * to avoid float/precision loss (e.g. USDT 6-decimals as a decimal string,
   * or whole Stars as a string of an integer). Never a JS number/float.
   */
  amount: string
  /** Asset/currency code, e.g. 'USDT', 'TON', 'BTC', 'XTR', 'TRX'. */
  asset: string
  expiresAt: Date
}

/** Statuses reported by verifyWebhook / checkStatus, unified across providers. */
export type PaymentEventStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'underpaid'

/**
 * Raw inbound webhook payload. Signature verification MUST be performed over
 * `rawBody` (the exact bytes as received on the wire) — never over a
 * re-serialized/re-parsed JSON object. Re-serializing can silently reorder
 * keys, change number formatting, or alter whitespace, all of which would
 * change the byte sequence that produced the provider's HMAC and cause valid
 * signatures to fail, or — worse — make it possible to craft a payload that
 * re-serializes to something an attacker controls while still matching a
 * signature computed over a different original body.
 */
export interface RawWebhook {
  headers: Record<string, string | undefined>
  rawBody: Buffer
}

/** A verified, provider-agnostic payment event, ready for the caller to reconcile against an Order. */
export interface VerifiedEvent {
  provider: PaymentProviderId
  invoiceId: string
  /** Our internal orderId, when the provider round-tripped it (e.g. via payload/label). */
  orderId?: string
  status: PaymentEventStatus
  /** Amount actually received, in the smallest unit of `asset`, as a string. */
  amount: string
  asset: string
  /** On-chain transaction hash, when applicable (TRON). */
  txHash?: string
  /** Confirmation count, when applicable (TRON). */
  confirmations?: number
  /** The original decoded payload, for audit logging. */
  raw: unknown
}

/** The single interface every payment adapter must implement. */
export interface PaymentProvider {
  id: PaymentProviderId
  createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice>
  /**
   * Verifies an inbound webhook's authenticity and maps it to a VerifiedEvent.
   * Returns null when the webhook is not authentic (bad signature, replay, or
   * otherwise untrusted) — callers MUST treat null as "ignore, do not act".
   */
  verifyWebhook(raw: RawWebhook): Promise<VerifiedEvent | null>
  /** Polling fallback for reconciliation jobs. */
  checkStatus(invoiceId: string): Promise<'pending' | 'paid' | 'expired' | 'failed'>
}
