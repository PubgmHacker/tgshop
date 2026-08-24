// Boots the Fastify app in-process (no network, no Telegram) and exercises the
// API surface with fastify.inject(), so route registration and the auth guards
// can be verified without a real BOT_TOKEN.
import { buildServer } from '../apps/bot/dist/server/app.js'
import { createBot } from '../apps/bot/dist/bot/index.js'
import { issueMiniAppJwt } from '../apps/bot/dist/server/auth.js'
import { prisma } from '../packages/db/dist/index.js'

const bot = createBot()
const app = await buildServer(bot)
await app.ready()

console.log('=== ROUTES ===')
console.log(app.printRoutes({ commonPrefix: false }))

const auth = { authorization: `Bearer ${process.env.SERVICE_TOKEN}` }

// ── /api/admin gate fixtures ─────────────────────────────────────────────────
// Two throwaway users: one whose tgId is in ADMIN_IDS (first entry of the env
// list) and one who is not. JWTs are minted directly — the same issueMiniAppJwt
// the real /api/auth/telegram uses — so the checks exercise requireJwtAuth +
// requireAdmin exactly as production traffic would.
const adminTgId = (process.env.ADMIN_IDS ?? '').split(',')[0]?.trim()
if (!adminTgId) {
  console.error('ADMIN_IDS is empty; cannot verify the /api/admin gate')
  process.exit(1)
}
const outsiderTgId = '444555666777'
if ((process.env.ADMIN_IDS ?? '').includes(outsiderTgId)) {
  console.error(`outsider tgId ${outsiderTgId} unexpectedly present in ADMIN_IDS`)
  process.exit(1)
}

async function ensureUser(tgId, username) {
  return prisma.user.upsert({
    where: { tgId: BigInt(tgId) },
    update: {},
    create: { tgId: BigInt(tgId), username, firstName: 'Verify' }
  })
}

const adminUser = await ensureUser(adminTgId, 'verify-api-admin')
const outsiderUser = await ensureUser(outsiderTgId, 'verify-api-outsider')

const adminJwt = { authorization: `Bearer ${issueMiniAppJwt({ sub: adminUser.id, tgId: adminTgId })}` }
const outsiderJwt = { authorization: `Bearer ${issueMiniAppJwt({ sub: outsiderUser.id, tgId: outsiderTgId })}` }

// [method, url, headers, payload, expected]
const checks = [
  ['GET', '/health', {}, undefined, 200],
  ['GET', '/api/catalog', {}, undefined, 401],
  ['GET', '/api/me', {}, undefined, 401],
  ['GET', '/internal/stats', {}, undefined, 401],
  ['GET', '/internal/stats', auth, undefined, 200],
  ['GET', '/internal/stock', auth, undefined, 200],
  ['GET', '/internal/stats', { authorization: 'Bearer wrong-token' }, undefined, 401],
  ['POST', '/api/auth/telegram', {}, {}, 400],

  // docs/AGENT_PLAN.md surface: reconcile / anomalies / gated refund.
  ['POST', '/internal/reconcile', {}, { provider: 'CRYPTOBOT' }, 401],
  ['POST', '/internal/reconcile', auth, {}, 400],
  ['POST', '/internal/reconcile', auth, { provider: 'BALANCE' }, 400],
  ['POST', '/internal/reconcile', auth, { provider: 'CRYPTOBOT', sinceMinutes: 60 }, 202],
  ['POST', '/internal/anomalies', {}, {}, 401],
  ['POST', '/internal/anomalies', auth, { severity: 'nope' }, 400],
  [
    'POST',
    '/internal/anomalies',
    auth,
    {
      severity: 'info',
      category: 'verify',
      summary: 'verify-api smoke check',
      relatedEntity: { type: 'System', id: 'verify-api' },
      source: 'verify-api'
    },
    201
  ],
  ['POST', '/internal/orders/does-not-exist/refund', {}, { reason: 'x' }, 401],
  ['POST', '/internal/orders/does-not-exist/refund', auth, {}, 400],
  ['POST', '/internal/orders/does-not-exist/refund', auth, { reason: 'verify-api smoke check' }, 404],

  // /api/admin gate: 401 without a JWT, 403 with a non-admin JWT, 200 as admin.
  ['GET', '/api/admin/stats', {}, undefined, 401],
  ['GET', '/api/admin/stats', outsiderJwt, undefined, 403],
  ['GET', '/api/admin/stats', adminJwt, undefined, 200],
  ['GET', '/api/admin/orders', outsiderJwt, undefined, 403],
  ['GET', '/api/admin/orders', adminJwt, undefined, 200],
  ['GET', '/api/admin/orders?status=NOPE', adminJwt, undefined, 400],
  ['GET', '/api/admin/catalog', adminJwt, undefined, 200],
  ['GET', '/api/admin/users', adminJwt, undefined, 200],
  ['GET', '/api/admin/promos', adminJwt, undefined, 200],
  ['GET', '/api/admin/settings', adminJwt, undefined, 200],
  ['GET', '/api/admin/audit', adminJwt, undefined, 200],
  // Failing writes only — verify-api must not mutate catalog/settings state.
  ['PUT', '/api/admin/settings/unknown_key', adminJwt, { value: 1 }, 404],
  ['PUT', '/api/admin/settings/referral_percent', adminJwt, { value: 'not-a-number' }, 400],
  ['PUT', '/api/admin/settings/referral_percent', outsiderJwt, { value: 10 }, 403],
  ['POST', '/api/admin/categories', adminJwt, { title: 'X', slug: 'BAD SLUG' }, 400],
  ['POST', '/api/admin/orders/does-not-exist/refund', adminJwt, { reason: 'verify-api' }, 404],
  ['POST', '/api/admin/orders/does-not-exist/refund', outsiderJwt, { reason: 'verify-api' }, 403],
  ['POST', `/api/admin/users/${outsiderUser.id}/balance`, adminJwt, { amountCents: 0, comment: 'x', idempotencyKey: 'verify-api-zero' }, 400],
  ['GET', '/api/admin/plans/does-not-exist/stock', adminJwt, undefined, 404]
]

console.log('=== CHECKS ===')
let failures = 0
for (const [method, url, headers, payload, expected] of checks) {
  const res = await app.inject({ method, url, headers, payload })
  const ok = res.statusCode === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${res.statusCode} (expected ${expected})${ok ? '' : ' BODY=' + res.body.slice(0, 200)}`)
}

// The anomaly check above writes one AuditLog row; remove it so repeated runs
// do not accumulate smoke-test entries in the dev database.
const cleaned = await prisma.auditLog.deleteMany({
  where: { actorType: 'agent', actorId: 'verify-api', action: 'anomaly.flagged' }
})
console.log(`cleanup: removed ${cleaned.count} verify-api audit row(s)`)

// Remove the gate fixtures, but ONLY rows this script created (marker username)
// and only when nothing references them — a pre-existing user with the same
// tgId keeps its username in the upsert above and is therefore left alone.
const removedUsers = await prisma.user.deleteMany({
  where: {
    tgId: { in: [BigInt(adminTgId), BigInt(outsiderTgId)] },
    username: { startsWith: 'verify-api-' },
    orders: { none: {} },
    balanceTransactions: { none: {} }
  }
})
console.log(`cleanup: removed ${removedUsers.count} verify-api user fixture(s)`)

console.log(failures === 0 ? 'ALL API CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
await app.close()
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
