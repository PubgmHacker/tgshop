// Asserts that the seed landed and that a StockItem payload encrypted by
// packages/db/prisma/seed.ts decrypts with @tgshop/core's key/format — the two
// implementations must stay byte-compatible or delivery silently breaks.
//
// The counts are asserted, not just printed: this runs in CI right after
// `pnpm db:seed`, where nobody reads the log unless the job goes red. They are
// exact rather than lower bounds so that a re-seed which duplicates rows fails
// here too — the stock block is idempotent by construction (deterministic
// `seed-stock-<sha256>` ids) and a regression that broke it would otherwise
// only surface as a slowly growing pool.
import { prisma } from '../packages/db/dist/index.js'
import { decrypt } from '../packages/core/dist/index.js'

const EXPECTED = { categories: 3, products: 6, plans: 12, stock: 20 }
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
  prisma.category.count(),
  prisma.product.count(),
  prisma.plan.count(),
  prisma.stockItem.count(),
  prisma.adminUser.count()
])
console.log(`categories=${categories} products=${products} plans=${plans} stock=${stock} admins=${admins}`)

check('category count', categories, EXPECTED.categories)
check('product count', products, EXPECTED.products)
check('plan count', plans, EXPECTED.plans)
check('stock count', stock, EXPECTED.stock)
// Lower bound on purpose: an operator who already ran create-admin.mjs against
// this database has more than the seeded row, which is correct, not a failure.
check('at least the seeded admin exists', admins >= 1, true)

const settings = await prisma.setting.findMany()
console.log('settings:', settings.map((s) => `${s.key}=${JSON.stringify(s.value)}`).join(', '))
for (const key of EXPECTED_SETTINGS) {
  check(`setting ${key} is present`, settings.some((s) => s.key === key), true)
}

// The catalog's shape, not just its size: the seed gives every product two
// plans and every category two products. Bare counts would still pass if the
// rows all piled onto one parent, which renders as a mostly-empty storefront.
// (Plan.productId and Product.categoryId are both non-nullable, so there is no
// orphan case to test — referential integrity already covers that.)
const productsWithPlans = await prisma.product.findMany({
  select: { slug: true, _count: { select: { plans: true } } }
})
check(
  'every product has exactly 2 plans',
  productsWithPlans.filter((p) => p._count.plans !== 2).map((p) => p.slug),
  []
)

const categoriesWithProducts = await prisma.category.findMany({
  select: { slug: true, _count: { select: { products: true } } }
})
check(
  'every category has exactly 2 products',
  categoriesWithProducts.filter((c) => c._count.products !== 2).map((c) => c.slug),
  []
)

// Stock must be AVAILABLE to be sellable. Anything else means either a real
// order consumed it (fine on a dev box, so this is a lower bound) or the seed
// wrote the wrong status.
const available = await prisma.stockItem.count({ where: { status: 'AVAILABLE' } })
console.log(`available stock: ${available}/${stock}`)
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
