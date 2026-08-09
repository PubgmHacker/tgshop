import { createHash, createHmac } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCryptoBotProvider, type CryptoBotConfig } from '../src/cryptobot.js'

// NOTE: we mock `fetch` via dependency injection (the adapter's `deps.fetchImpl`)
// rather than patching the network layer with nock, because Node 20's global
// `fetch` (undici) does not route through the `http`/`https` agents that nock
// intercepts. Injecting a fetch mock is the equivalent, more reliable
// technique for this runtime and still fully exercises HTTP-shaped request/
// response handling without hitting the network.

const config: CryptoBotConfig = {
  apiToken: 'test-api-token',
  baseUrl: 'https://pay.crypt.bot/api',
  webhookSignatureHeader: 'crypto-pay-api-signature',
  defaultAsset: 'USDT',
  invoiceExpirySeconds: 1800
}

function signBody(rawBody: Buffer, apiToken: string): string {
  const key = createHash('sha256').update(apiToken).digest()
  return createHmac('sha256', key).update(rawBody).digest('hex')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function makeWebhookBody(overrides: Partial<{ paidAt: string; invoiceId: number; orderId: string }> = {}) {
  const paidAt = overrides.paidAt ?? new Date().toISOString()
  return {
    update_id: 1,
    update_type: 'invoice_paid' as const,
    request_date: paidAt,
    payload: {
      invoice_id: overrides.invoiceId ?? 12345,
      status: 'paid' as const,
      asset: 'USDT',
      amount: '19.99',
      payload: overrides.orderId ?? 'order_abc',
      paid_at: paidAt
    }
  }
}

describe('cryptobot provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createInvoice posts to /createInvoice and maps the response', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('/createInvoice')
      return jsonResponse({
        ok: true,
        result: {
          invoice_id: 555,
          status: 'active',
          hash: 'h',
          asset: 'USDT',
          amount: '19.99',
          pay_url: 'https://pay.crypt.bot/x',
          bot_invoice_url: 'https://t.me/CryptoBot?start=x',
          created_at: new Date().toISOString(),
          expiration_date: new Date(Date.now() + 1800_000).toISOString(),
          payload: 'order_abc'
        }
      })
    })

    const provider = createCryptoBotProvider(config, { fetchImpl: fetchMock as unknown as typeof fetch })
    const invoice = await provider.createInvoice({
      orderId: 'order_abc',
      userId: 'user_1',
      amountCents: 1999,
      description: 'Test plan'
    })

    expect(invoice.invoiceId).toBe('555')
    expect(invoice.asset).toBe('USDT')
    expect(invoice.amount).toBe('19.99')
    expect(invoice.payUrl).toBe('https://t.me/CryptoBot?start=x')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a valid webhook signature', async () => {
    const provider = createCryptoBotProvider(config)
    const body = makeWebhookBody()
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8')
    const signature = signBody(rawBody, config.apiToken)

    const event = await provider.verifyWebhook({
      headers: { 'crypto-pay-api-signature': signature },
      rawBody
    })

    expect(event).not.toBeNull()
    expect(event?.status).toBe('paid')
    expect(event?.orderId).toBe('order_abc')
    expect(event?.provider).toBe('cryptobot')
  })

  it('rejects a webhook with a tampered signature', async () => {
    const provider = createCryptoBotProvider(config)
    const body = makeWebhookBody()
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8')
    const validSignature = signBody(rawBody, config.apiToken)
    // Tamper the body after signing, but keep the old (now invalid) signature.
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...body, payload: { ...body.payload, amount: '999.99' } })
    )

    const event = await provider.verifyWebhook({
      headers: { 'crypto-pay-api-signature': validSignature },
      rawBody: tamperedBody
    })

    expect(event).toBeNull()
  })

  it('rejects a replayed webhook older than 5 minutes', async () => {
    const provider = createCryptoBotProvider(config)
    const oldPaidAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const body = makeWebhookBody({ paidAt: oldPaidAt })
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8')
    const signature = signBody(rawBody, config.apiToken)

    const event = await provider.verifyWebhook({
      headers: { 'crypto-pay-api-signature': signature },
      rawBody
    })

    expect(event).toBeNull()
  })

  it('checkStatus reflects expiry via getInvoices', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('/getInvoices')
      return jsonResponse({
        ok: true,
        result: {
          items: [
            {
              invoice_id: 555,
              status: 'expired',
              asset: 'USDT',
              amount: '19.99',
              created_at: new Date().toISOString()
            }
          ]
        }
      })
    })

    const provider = createCryptoBotProvider(config, { fetchImpl: fetchMock as unknown as typeof fetch })
    const status = await provider.checkStatus('555')
    expect(status).toBe('expired')
  })
})
