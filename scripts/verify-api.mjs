// Boots the Fastify app in-process (no network, no Telegram) and exercises the
// API surface with fastify.inject(), so route registration and the auth guards
// can be verified without a real BOT_TOKEN.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Keep this verifier runnable from a fresh checkout. Node does not load .env
// files by default, while the bot's config is intentionally fail-fast at
// import time. Only fill variables that are not already present, so CI and an
// explicitly exported environment remain authoritative.
function loadDotEnv() {
  const file = resolve(process.cwd(), '.env')
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]] !== undefined) continue
    const value = match[2].trim()
    process.env[match[1]] =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value.replace(/\s+#.*$/, '')
  }
}

loadDotEnv()

const { buildServer } = await import('../apps/bot/dist/server/app.js')
const { createBot } = await import('../apps/bot/dist/bot/index.js')
const { issueMiniAppJwt } = await import('../apps/bot/dist/server/auth.js')
const { prisma } = await import('../packages/db/dist/index.js')

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

const adminJwt = {
  authorization: `Bearer ${issueMiniAppJwt({ sub: adminUser.id, tgId: adminTgId })}`
}
const outsiderJwt = {
  authorization: `Bearer ${issueMiniAppJwt({ sub: outsiderUser.id, tgId: outsiderTgId })}`
}

// [method, url, headers, payload, expected]
const checks = [
  ['GET', '/health', {}, undefined, 200],
  ['GET', '/metrics', {}, undefined, 401],
  ['GET', '/metrics', auth, undefined, 200],
  ['GET', '/api/public/catalog', {}, undefined, 200],
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
  [
    'POST',
    '/internal/orders/does-not-exist/refund',
    auth,
    { reason: 'verify-api smoke check' },
    404
  ],

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
  ['POST', '/api/admin/orders/does-not-exist/manual-deliver', {}, { payload: 'verify-api' }, 401],
  [
    'POST',
    '/api/admin/orders/does-not-exist/manual-deliver',
    adminJwt,
    { payload: 'verify-api' },
    404
  ],
  [
    'POST',
    `/api/admin/users/${outsiderUser.id}/balance`,
    adminJwt,
    { amountCents: 0, comment: 'x', idempotencyKey: 'verify-api-zero' },
    400
  ],
  ['GET', '/api/admin/plans/does-not-exist/stock', adminJwt, undefined, 404]
]

console.log('=== CHECKS ===')
let failures = 0
for (const [method, url, headers, payload, expected] of checks) {
  const res = await app.inject({ method, url, headers, payload })
  const ok = res.statusCode === expected
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${res.statusCode} (expected ${expected})${ok ? '' : ' BODY=' + res.body.slice(0, 200)}`
  )
}

// Validate the seeded featured offer across every public/customer/admin projection.
const merchandisingChecks = [
  ['/api/home', outsiderJwt, body => body.bestsellers],
  ['/api/catalog', outsiderJwt, body => body.categories.flatMap(category => category.products)],
  ['/api/categories/code', outsiderJwt, body => body.products],
  ['/api/public/catalog', {}, body => body.products],
  ['/api/admin/catalog', adminJwt, body => body.categories.flatMap(category => category.products)]
]
for (const [url, headers, productsFrom] of merchandisingChecks) {
  const response = await app.inject({ method: 'GET', url, headers })
  const products = response.statusCode === 200 ? productsFrom(response.json()) : []
  const ok = products[0]?.slug === 'mirasim'
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} Mirasim first in ${url}`)
}
const announcementResponse = await app.inject({ method: 'GET', url: '/api/admin/broadcasts', headers: adminJwt })
const template = announcementResponse.json().templates?.find(item => item.id === 'mirasim-launch')
const templateOk = announcementResponse.statusCode === 200 && template?.text.includes('product_mirasim') && template?.text.includes('по приглашениям')
if (!templateOk) failures++
console.log(`${templateOk ? 'PASS' : 'FAIL'} reviewable Mirasim announcement template`)

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
