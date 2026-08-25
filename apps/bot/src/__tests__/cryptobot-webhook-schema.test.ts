import { describe, expect, it } from 'vitest'
import { cryptoBotWebhookSchema } from '../server/routes/cryptobotWebhook.js'

// Regression guard for a bug found in production on 2026-08-25: the shop
// creates FIAT invoices, and Crypto Pay's Invoice object for currency_type
// 'fiat' has no `asset` field (the crypto actually paid arrives as
// `paid_asset`). The schema used to require `asset`, so every real payment
// webhook was answered 400 and CryptoBot redelivered it with backoff until
// the payments-poll worker settled the money instead. These bodies mirror
// the documented invoice_paid update shape, not hand-trimmed fixtures.

/** A paid FIAT invoice as Crypto Pay delivers it — note: no `asset` key. */
const FIAT_PAID_UPDATE = {
  update_id: 12345,
  update_type: 'invoice_paid',
  request_date: '2026-08-25T07:52:36.000Z',
  payload: {
    invoice_id: 61305273,
    hash: 'IVJNSBR4VFcO',
    currency_type: 'fiat',
    fiat: 'USD',
    amount: '0.10',
    paid_asset: 'USDT',
    paid_amount: '0.1',
    paid_fiat_rate: '1.0',
    accepted_assets: ['USDT', 'TON', 'BTC'],
    fee_asset: 'USDT',
    fee_amount: 0.003,
    status: 'paid',
    created_at: '2026-08-25T07:20:00.000Z',
    paid_at: '2026-08-25T07:52:35.000Z',
    allow_comments: true,
    allow_anonymous: true,
    payload: 'topup_cm000000000000000000000'
  }
}

describe('cryptoBotWebhookSchema', () => {
  it('accepts a paid FIAT invoice, which carries no asset field', () => {
    const parsed = cryptoBotWebhookSchema.safeParse(FIAT_PAID_UPDATE)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.payload.invoice_id).toBe(61305273)
    expect(parsed.data.payload.status).toBe('paid')
    expect(parsed.data.payload.amount).toBe('0.10')
    expect(parsed.data.payload.payload).toBe('topup_cm000000000000000000000')
  })

  it('accepts a CRYPTO invoice, where asset is present', () => {
    const update = {
      ...FIAT_PAID_UPDATE,
      payload: {
        ...FIAT_PAID_UPDATE.payload,
        currency_type: 'crypto',
        asset: 'USDT',
        fiat: undefined
      }
    }
    const parsed = cryptoBotWebhookSchema.safeParse(update)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.payload.asset).toBe('USDT')
  })

  it('accepts an invoice without a custom payload reference (no-op update)', () => {
    const { payload: _ref, ...invoiceRest } = FIAT_PAID_UPDATE.payload
    const parsed = cryptoBotWebhookSchema.safeParse({ ...FIAT_PAID_UPDATE, payload: invoiceRest })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.payload.payload).toBeUndefined()
  })

  it('still rejects a body without invoice_id', () => {
    const { invoice_id: _id, ...invoiceRest } = FIAT_PAID_UPDATE.payload
    const parsed = cryptoBotWebhookSchema.safeParse({ ...FIAT_PAID_UPDATE, payload: invoiceRest })
    expect(parsed.success).toBe(false)
  })
})
