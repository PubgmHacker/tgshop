// Boots the Fastify app in-process (no network, no Telegram) and exercises the
// API surface with fastify.inject(), so route registration and the auth guards
// can be verified without a real BOT_TOKEN.
import { buildServer } from '../apps/bot/dist/server/app.js'
import { createBot } from '../apps/bot/dist/bot/index.js'

const bot = createBot()
const app = await buildServer(bot)
await app.ready()

console.log('=== ROUTES ===')
console.log(app.printRoutes({ commonPrefix: false }))

const checks = [
  ['GET', '/health', {}, 200],
  ['GET', '/api/catalog', {}, 401],
  ['GET', '/api/me', {}, 401],
  ['GET', '/internal/stats', {}, 401],
  ['GET', '/internal/stats', { authorization: `Bearer ${process.env.SERVICE_TOKEN}` }, 200],
  ['GET', '/internal/stock', { authorization: `Bearer ${process.env.SERVICE_TOKEN}` }, 200],
  ['GET', '/internal/stats', { authorization: 'Bearer wrong-token' }, 401],
  ['POST', '/api/auth/telegram', {}, 400]
]

console.log('=== CHECKS ===')
let failures = 0
for (const [method, url, headers, expected] of checks) {
  const res = await app.inject({ method, url, headers, payload: method === 'POST' ? {} : undefined })
  const ok = res.statusCode === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${res.statusCode} (expected ${expected})${ok ? '' : ' BODY=' + res.body.slice(0, 200)}`)
}
console.log(failures === 0 ? 'ALL API CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
await app.close()
process.exit(failures === 0 ? 0 : 1)
