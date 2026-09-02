import { describe, expect, it } from 'vitest'
import { tronTaggedAmountUsdt6 } from '@tgshop/core'
import { matchTransfer, type OpenInvoice } from '../lib/tron-match.js'

const at = (iso: string) => new Date(iso)

function invoice(overrides: Partial<OpenInvoice> & { id: string; amountUsdt6: bigint }): OpenInvoice {
  return { status: 'PENDING', txHash: null, createdAt: at('2026-09-02T10:00:00Z'), ...overrides }
}

describe('matchTransfer', () => {
  const a = invoice({ id: 'A', amountUsdt6: tronTaggedAmountUsdt6(2900, 57) }) // 29.0057
  const b = invoice({ id: 'B', amountUsdt6: tronTaggedAmountUsdt6(1000, 12) }) // 10.0012

  it('settles the invoice whose tagged amount matches exactly', () => {
    const res = matchTransfer({ txid: 'tx1', amountUsdt6: 29_005_700n }, [a, b])
    expect(res).toEqual({ kind: 'exact', invoice: a })
  })

  it('recognises a transfer it already recorded on an invoice', () => {
    const confirming = invoice({ id: 'C', amountUsdt6: 5_000_100n, status: 'CONFIRMING', txHash: 'tx9' })
    expect(matchTransfer({ txid: 'tx9', amountUsdt6: 5_000_100n }, [confirming, a])).toEqual({
      kind: 'already-recorded',
      invoice: confirming
    })
  })

  it('does not hand a second transfer to an invoice another tx already settled', () => {
    const taken = invoice({ id: 'T', amountUsdt6: 29_005_700n, status: 'CONFIRMING', txHash: 'tx-old' })
    const res = matchTransfer({ txid: 'tx-new', amountUsdt6: 29_005_700n }, [taken])
    expect(res.kind).toBe('unmatched')
  })

  it('lets an UNDERPAID invoice absorb a follow-up transfer', () => {
    const short = invoice({ id: 'U', amountUsdt6: 29_005_700n, status: 'UNDERPAID', txHash: 'tx-first' })
    expect(matchTransfer({ txid: 'tx-second', amountUsdt6: 29_005_700n }, [short])).toEqual({ kind: 'exact', invoice: short })
    expect(matchTransfer({ txid: 'tx-third', amountUsdt6: 1_005_700n }, [short])).toEqual({ kind: 'by-tag', invoice: short })
  })

  it('attributes a wrong amount by its unique sub-cent tag (under/overpayment)', () => {
    expect(matchTransfer({ txid: 'tx2', amountUsdt6: 28_005_700n }, [a, b])).toEqual({ kind: 'by-tag', invoice: a })
    expect(matchTransfer({ txid: 'tx3', amountUsdt6: 30_005_700n }, [a, b])).toEqual({ kind: 'by-tag', invoice: a })
  })

  it('refuses to guess when the tag is missing, unknown or shared', () => {
    expect(matchTransfer({ txid: 'tx4', amountUsdt6: 29_000_000n }, [a, b])).toEqual({ kind: 'unmatched', reason: 'no-tag' })
    expect(matchTransfer({ txid: 'tx5', amountUsdt6: 29_009_900n }, [a, b])).toEqual({ kind: 'unmatched', reason: 'unknown-tag' })
    const sameTag = invoice({ id: 'S', amountUsdt6: tronTaggedAmountUsdt6(500, 57) })
    expect(matchTransfer({ txid: 'tx6', amountUsdt6: 7_005_700n }, [a, sameTag])).toEqual({
      kind: 'unmatched',
      reason: 'ambiguous-tag'
    })
  })

  it('prefers a live invoice over an expired one with the same amount, then the newest', () => {
    const expired = invoice({ id: 'E', amountUsdt6: 29_005_700n, status: 'EXPIRED', createdAt: at('2026-09-02T11:00:00Z') })
    const older = invoice({ id: 'O', amountUsdt6: 29_005_700n, createdAt: at('2026-09-02T09:00:00Z') })
    expect(matchTransfer({ txid: 'tx7', amountUsdt6: 29_005_700n }, [expired, older, a]).invoice?.id).toBe('A')
    expect(matchTransfer({ txid: 'tx8', amountUsdt6: 29_005_700n }, [expired]).invoice?.id).toBe('E')
  })
})
