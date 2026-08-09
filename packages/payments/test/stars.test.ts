import { describe, it, expect } from 'vitest'
import {
  createStarsProvider,
  buildSendInvoicePayload,
  usdCentsToStarsWithOverride,
  type StarsConfig
} from '../src/stars.js'

const config: StarsConfig = {
  botToken: 'test-bot-token',
  apiBaseUrl: 'https://api.telegram.org'
}

describe('stars provider', () => {
  it('buildSendInvoicePayload builds a valid XTR invoice payload', () => {
    const payload = buildSendInvoicePayload({
      chatId: 42,
      orderId: 'order_1',
      title: 'Premium Plan',
      description: '1 month access',
      priceStars: 150
    })
    expect(payload.currency).toBe('XTR')
    expect(payload.provider_token).toBe('')
    expect(payload.prices).toEqual([{ label: 'Premium Plan', amount: 150 }])
    expect(payload.payload).toBe('order_1')
  })

  it('usdCentsToStarsWithOverride prefers the override when present', () => {
    const stars = usdCentsToStarsWithOverride(1999, 135n, 100n, 200)
    expect(stars).toBe(200)
  })

  it('usdCentsToStarsWithOverride computes from rate when no override given', () => {
    // 1999 cents = $19.99, rate 1.35 stars per $1 -> ~26.99 stars, rounds to 27
    const stars = usdCentsToStarsWithOverride(1999, 135n, 100n)
    expect(stars).toBe(27)
  })

  it('verifyWebhook maps a valid successful_payment update to a paid VerifiedEvent', async () => {
    const provider = createStarsProvider(config)
    const update = {
      update_id: 1,
      message: {
        successful_payment: {
          currency: 'XTR',
          total_amount: 150,
          invoice_payload: 'order_1',
          telegram_payment_charge_id: 'charge_abc',
          provider_payment_charge_id: 'provider_abc'
        }
      }
    }
    const rawBody = Buffer.from(JSON.stringify(update), 'utf8')
    const event = await provider.verifyWebhook({ headers: {}, rawBody })

    expect(event).not.toBeNull()
    expect(event?.provider).toBe('stars')
    expect(event?.status).toBe('paid')
    expect(event?.orderId).toBe('order_1')
    expect(event?.amount).toBe('150')
    expect(event?.txHash).toBe('charge_abc')
  })

  it('verifyWebhook returns null for updates without a successful_payment', async () => {
    const provider = createStarsProvider(config)
    const update = { update_id: 2, message: { text: 'hi' } }
    const rawBody = Buffer.from(JSON.stringify(update), 'utf8')
    const event = await provider.verifyWebhook({ headers: {}, rawBody })
    expect(event).toBeNull()
  })

  it('verifyWebhook returns null for a non-XTR currency', async () => {
    const provider = createStarsProvider(config)
    const update = {
      update_id: 3,
      message: {
        successful_payment: {
          currency: 'USD',
          total_amount: 150,
          invoice_payload: 'order_1',
          telegram_payment_charge_id: 'charge_abc',
          provider_payment_charge_id: 'provider_abc'
        }
      }
    }
    const rawBody = Buffer.from(JSON.stringify(update), 'utf8')
    const event = await provider.verifyWebhook({ headers: {}, rawBody })
    expect(event).toBeNull()
  })
})
