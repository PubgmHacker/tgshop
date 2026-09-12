import Fastify from 'fastify'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../payments/tron.js', () => ({
  TronTagReservationError: class extends Error {},
  TronTagsExhaustedError: class extends Error {}
}))
const { registerSecurityPlugins } = await import('../server/plugins/security.js')
const { describeError } = await import('../lib/httpErrors.js')

async function server() {
  const app = Fastify({ bodyLimit: 128 })
  await registerSecurityPlugins(app)
  app.setErrorHandler((err, _req, reply) => {
    const mapped = describeError(err, 'en')
    return reply.code(mapped.status).send(mapped.body)
  })
  app.post('/parse', async (req) => ({ raw: req.rawBody, body: req.body }))
  app.get('/limited', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
  return app
}

describe('HTTP parsing and rate limiting through the real plugin', () => {
  it('preserves exact webhook bytes while parsing valid JSON', async () => {
    const app = await server()
    try {
      const raw = ' { "value" : "данные" } '
      const res = await app.inject({ method: 'POST', url: '/parse', headers: { 'content-type': 'application/json' }, payload: raw })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ raw, body: { value: 'данные' } })
    } finally { await app.close() }
  })

  it.each(['{"broken":', '{"__proto__":{"polluted":true}}', '{"constructor":{"prototype":{"polluted":true}}}'])(
    'rejects invalid or poisoned JSON without a 500: %s', async (payload) => {
      const app = await server()
      try {
        const res = await app.inject({ method: 'POST', url: '/parse', headers: { 'content-type': 'application/json' }, payload })
        expect(res.statusCode).toBe(400)
        expect(res.json().error.code).toBe('VALIDATION_ERROR')
      } finally { await app.close() }
    })

  it('returns 413 for oversized payloads and 429 for throttled requests', async () => {
    const app = await server()
    try {
      const large = await app.inject({ method: 'POST', url: '/parse', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ text: 'x'.repeat(200) }) })
      expect(large.statusCode).toBe(413)
      expect((await app.inject('/limited')).statusCode).toBe(200)
      const limited = await app.inject('/limited')
      expect(limited.statusCode).toBe(429)
      expect(limited.json().error.code).toBe('RATE_LIMITED')
      expect(limited.headers['retry-after']).toBeDefined()
    } finally { await app.close() }
  })
})
