// Asserts that the seed landed and that a StockItem payload encrypted by
// packages/db/prisma/seed.ts decrypts with @tgshop/core's key/format — the two
// implementations must stay byte-compatible or delivery silently breaks.
//
// The counts are asserted, not just printed: this runs in CI right after
// `pnpm db:seed`, where nobody reads the log unless the job goes red. They are
// exact rather than lower bounds so that a re-seed which duplicates rows fails
// here too — the stock block is idempotent by construction (deterministic
// `seed-stock-<plan>-<index>` ids) and a regression that broke it would otherwise
// only surface as a slowly growing pool.
import { prisma } from '../packages/db/dist/index.js'
import { decrypt } from '../packages/core/dist/index.js'

const EXPECTED = { activeCategories: 3, activeProducts: 7, activePlans: 13, seededStock: 24 }
const EXPECTED_SETTINGS = ['stars_usd_rate', 'min_topup_cents', 'support_url', 'referral_percent']

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`
  )
}

console.log('=== SEED ===')

const [categories, products, plans, stock, admins] = await Promise.all([
  prisma.category.count({ where: { isActive: true } }),
  prisma.product.count({ where: { isActive: true } }),
  prisma.plan.count({ where: { isActive: true, product: { isActive: true } } }),
  prisma.stockItem.count({ where: { id: { startsWith: 'seed-stock-' } } }),
  prisma.adminUser.count()
])
console.log(
  `activeCategories=${categories} activeProducts=${products} activePlans=${plans} seededStock=${stock} admins=${admins}`
)

check('active category count', categories, EXPECTED.activeCategories)
check('active product count', products, EXPECTED.activeProducts)
check('active plan count', plans, EXPECTED.activePlans)
check('seeded stock count', stock, EXPECTED.seededStock)
// Lower bound on purpose: an operator who already ran create-admin.mjs against
// this database has more than the seeded row, which is correct, not a failure.
check('at least the seeded admin exists', admins >= 1, true)

const settings = await prisma.setting.findMany()
console.log('settings:', settings.map((s) => `${s.key}=${JSON.stringify(s.value)}`).join(', '))
for (const key of EXPECTED_SETTINGS) {
  check(
    `setting ${key} is present`,
    settings.some((s) => s.key === key),
    true
  )
}

// The catalog's shape, not just its size: the seed gives normal products two
// plans, while Mirasim is a deliberate one-plan manual-delivery product. Bare
// counts would still pass if rows all piled onto one parent.
// (Plan.productId and Product.categoryId are both non-nullable, so there is no
// orphan case to test — referential integrity already covers that.)
const productsWithPlans = await prisma.product.findMany({
  where: { isActive: true },
  select: { slug: true, _count: { select: { plans: true } } }
})
check(
  'normal products have exactly 2 plans',
  productsWithPlans.filter((p) => p.slug !== 'mirasim' && p._count.plans !== 2).map((p) => p.slug),
  []
)
check(
  'mirasim has exactly 1 plan',
  productsWithPlans.filter((p) => p.slug === 'mirasim' && p._count.plans !== 1).map((p) => p.slug),
  []
)

const categoriesWithProducts = await prisma.category.findMany({
  where: { isActive: true },
  select: {
    slug: true,
    isActive: true,
    _count: { select: { products: { where: { isActive: true } } } }
  }
})
const expectedProductCounts = { chat: 2, image: 2, code: 3 }
check(
  'active category product distribution',
  categoriesWithProducts
    .filter((c) => c.isActive && c._count.products !== expectedProductCounts[c.slug])
    .map((c) => `${c.slug}:${c._count.products}`),
  []
)

const mirasim = await prisma.product.findFirst({
  where: { slug: 'mirasim', isActive: true },
  select: {
    deliveryType: true,
    imageUrl: true,
    plans: { where: { isActive: true }, select: { id: true } }
  }
})
check(
  'mirasim is manual with official logo and one active plan',
  mirasim && {
    deliveryType: mirasim.deliveryType,
    imageUrl: mirasim.imageUrl,
    plans: mirasim.plans.length
  },
  {
    deliveryType: 'MANUAL_FALLBACK',
    imageUrl: 'https://mirasim.ai/site/mirasim-mark-white.png',
    plans: 1
  }
)

// Stock must be AVAILABLE to be sellable. Anything else means either a real
// order consumed it (fine on a dev box, so this is a lower bound) or the seed
// wrote the wrong status.
const available = await prisma.stockItem.count({ where: { status: 'AVAILABLE' } })
console.log(`available stock: ${available}/${stock} seeded rows`)
check('some stock is sellable', available > 0, true)

// The actual cross-package contract: seed.ts encrypts, @tgshop/core decrypts.
const item = await prisma.stockItem.findFirst({ where: { payloadEnc: { startsWith: 'v1:' } } })
check('a seeded stock item exists', item !== null, true)
if (item) {
  let plaintext = null
  try {
    plaintext = decrypt(item.payloadEnc)
  } catch (err) {
    console.log(`FAIL stock payload decrypts -> threw ${err.message}`)
    failures += 1
  }
  if (plaintext !== null) {
    console.log(`decrypted stock payload: ${JSON.stringify(plaintext)}`)
    check('decrypted payload is non-empty', plaintext.length > 0, true)
    // Shape written by seed.ts; a mismatch means the key round-tripped but the
    // two sides disagree about what was stored.
    check('decrypted payload has the seeded shape', plaintext.startsWith('demo-login:'), true)
  }
}

console.log(failures === 0 ? 'ALL SEED CHECKS PASSED' : `${failures} CHECK(S) FAILED`)

await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
