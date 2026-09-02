import { tronTagOfAmountUsdt6 } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// Pure matching of inbound USDT-TRC20 transfers to open TRON invoices.
//
// Every customer pays into the same static wallet, so the *amount* is the only
// thing that identifies an invoice: the bot issues each open invoice a unique
// sub-cent tag (0.0001 USDT steps, see @tgshop/core money.ts), and this module
// answers "which invoice does this transfer belong to?" without touching the
// database, so it can be tested exhaustively.
// ─────────────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'PENDING' | 'CONFIRMING' | 'UNDERPAID' | 'EXPIRED'

export interface OpenInvoice {
  id: string
  /** Exact tagged amount the customer was asked to send, USDT 6-decimals. */
  amountUsdt6: bigint
  status: InvoiceStatus
  /** Transfer already bound to this invoice (CONFIRMING/UNDERPAID), if any. */
  txHash: string | null
  createdAt: Date
}

export interface InboundTransfer {
  txid: string
  amountUsdt6: bigint
}

export type UnmatchedReason = 'no-tag' | 'unknown-tag' | 'ambiguous-tag'

export type MatchResult<I extends OpenInvoice = OpenInvoice> =
  /** Exact tagged amount: settle this invoice. */
  | { kind: 'exact'; invoice: I }
  /** Amount differs but the sub-cent tag is unique among open invoices: under/overpayment of this invoice. */
  | { kind: 'by-tag'; invoice: I }
  /** This txid is already recorded on an invoice (a previous scan saw it). */
  | { kind: 'already-recorded'; invoice: I }
  /** Nobody can claim it — an operator must credit it by hand. */
  | { kind: 'unmatched'; reason: UnmatchedReason }

/** An invoice can absorb a new transfer unless a different tx already settled it. */
function canTakeTransfer(invoice: OpenInvoice): boolean {
  return invoice.txHash === null || invoice.status === 'UNDERPAID'
}

/** Prefer live invoices over expired ones, then the most recently issued. */
function pickBest<I extends OpenInvoice>(candidates: I[]): I {
  return [...candidates].sort((a, b) => {
    const aExpired = a.status === 'EXPIRED' ? 1 : 0
    const bExpired = b.status === 'EXPIRED' ? 1 : 0
    if (aExpired !== bExpired) return aExpired - bExpired
    return b.createdAt.getTime() - a.createdAt.getTime()
  })[0] as I
}

export function matchTransfer<I extends OpenInvoice>(transfer: InboundTransfer, invoices: readonly I[]): MatchResult<I> {
  const recorded = invoices.find((inv) => inv.txHash === transfer.txid)
  if (recorded) return { kind: 'already-recorded', invoice: recorded }

  const exact = invoices.filter((inv) => inv.amountUsdt6 === transfer.amountUsdt6 && canTakeTransfer(inv))
  if (exact.length > 0) return { kind: 'exact', invoice: pickBest(exact) }

  const tag = tronTagOfAmountUsdt6(transfer.amountUsdt6)
  if (tag === 0) return { kind: 'unmatched', reason: 'no-tag' }

  const byTag = invoices.filter((inv) => tronTagOfAmountUsdt6(inv.amountUsdt6) === tag && canTakeTransfer(inv))
  if (byTag.length === 1) return { kind: 'by-tag', invoice: byTag[0] as I }
  if (byTag.length === 0) return { kind: 'unmatched', reason: 'unknown-tag' }
  return { kind: 'unmatched', reason: 'ambiguous-tag' }
}
