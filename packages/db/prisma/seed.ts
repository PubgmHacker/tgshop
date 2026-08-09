import { randomBytes, createCipheriv } from 'node:crypto'
import { PrismaClient, DeliveryType, StockStatus, AdminRole } from '@prisma/client'
import { hash } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Stock payload encryption (AES-256-GCM)
//
// This helper MUST be kept byte-for-byte compatible with the implementation
// that ships in @tgshop/core (packages/core). Downstream packages decrypt
// StockItem.payloadEnc / Order.deliveredPayloadEnc using this exact format:
//
//   v1:<ivB64>:<tagB64>:<ciphertextB64>
//
// - v1        literal version prefix, allows future format migrations
// - ivB64     12-byte random IV, base64-encoded
// - tagB64    16-byte GCM auth tag, base64-encoded
// - ctB64     ciphertext, base64-encoded
//
// ENCRYPTION_KEY env var is the raw 32-byte AES-256 key, provided as either a
// 64-char hex string or a base64 string (44 chars, padded). We accept both.
// ─────────────────────────────────────────────────────────────────────────────

const CIPHER_ALGO = 'aes-256-gcm'
const CIPHER_VERSION = 'v1'

function loadEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set; required to seed encrypted stock payloads')
  }
  const hexPattern = /^[0-9a-fA-F]{64}$/
  if (hexPattern.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}); expected 64-char hex or base64`
    )
  }
  return buf
}

function encryptPayload(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(CIPHER_ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${CIPHER_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString(
    'base64'
  )}`
}

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const key = loadEncryptionKey()

  // ── Categories ──────────────────────────────────────────────────────────
  const categoriesData = [
    { title: 'Streaming', slug: 'streaming', emoji: '🎬', sortOrder: 0 },
    { title: 'Gaming', slug: 'gaming', emoji: '🎮', sortOrder: 1 },
    { title: 'Software', slug: 'software', emoji: '💻', sortOrder: 2 }
  ]

  const categories = []
  for (const data of categoriesData) {
    const category = await prisma.category.upsert({
      where: { slug: data.slug },
      update: data,
      create: { ...data, isActive: true }
    })
    categories.push(category)
  }

  const [streaming, gaming, software] = categories
  if (!streaming || !gaming || !software) {
    throw new Error('failed to seed categories')
  }

  // ── Products (6) ────────────────────────────────────────────────────────
  const productsData = [
    {
      categoryId: streaming.id,
      title: 'Netflix Premium',
      slug: 'netflix-premium',
      description: 'Shared Netflix Premium 4K account access.',
      deliveryType: DeliveryType.STOCK_POOL,
      sortOrder: 0
    },
    {
      categoryId: streaming.id,
      title: 'Spotify Premium',
      slug: 'spotify-premium',
      description: 'Spotify Premium individual account, ad-free music.',
      deliveryType: DeliveryType.STOCK_POOL,
      sortOrder: 1
    },
    {
      categoryId: gaming.id,
      title: 'Steam Wallet Code',
      slug: 'steam-wallet-code',
      description: 'Steam Wallet top-up code, redeemable region-locked.',
      deliveryType: DeliveryType.UNIQUE_CODE,
      sortOrder: 0
    },
    {
      categoryId: gaming.id,
      title: 'PUBG Mobile UC',
      slug: 'pubg-mobile-uc',
      description: 'PUBG Mobile UC currency top-up via external API.',
      deliveryType: DeliveryType.EXTERNAL_API,
      sortOrder: 1
    },
    {
      categoryId: software.id,
      title: 'Windows 11 Pro Key',
      slug: 'windows-11-pro-key',
      description: 'Genuine retail Windows 11 Pro activation key.',
      deliveryType: DeliveryType.UNIQUE_CODE,
      sortOrder: 0
    },
    {
      categoryId: software.id,
      title: 'Office 2021 Key',
      slug: 'office-2021-key',
      description: 'Microsoft Office 2021 Home & Business activation key.',
      deliveryType: DeliveryType.MANUAL_FALLBACK,
      sortOrder: 1
    }
  ]

  const products = []
  for (const data of productsData) {
    const product = await prisma.product.upsert({
      where: { slug: data.slug },
      update: data,
      create: { ...data, isActive: true }
    })
    products.push(product)
  }

  // ── Plans (12, 2 per product) ───────────────────────────────────────────
  const plans = []
  for (const product of products) {
    const plan1 = await prisma.plan.upsert({
      where: { id: `${product.slug}-1m` },
      update: {},
      create: {
        id: `${product.slug}-1m`,
        productId: product.id,
        title: '1 месяц / 1 month',
        durationDays: 30,
        priceCents: 499,
        priceStars: 350,
        discountPercent: 0,
        lowStockThreshold: 3,
        isActive: true,
        sortOrder: 0
      }
    })
    const plan2 = await prisma.plan.upsert({
      where: { id: `${product.slug}-3m` },
      update: {},
      create: {
        id: `${product.slug}-3m`,
        productId: product.id,
        title: '3 месяца / 3 months',
        durationDays: 90,
        priceCents: 1299,
        priceStars: 900,
        discountPercent: 10,
        lowStockThreshold: 3,
        isActive: true,
        sortOrder: 1
      }
    })
    plans.push(plan1, plan2)
  }

  // ── Stock items (~20 demo, encrypted) ───────────────────────────────────
  let stockCount = 0
  for (const plan of plans) {
    if (stockCount >= 20) break
    const itemsForPlan = 2
    for (let i = 0; i < itemsForPlan && stockCount < 20; i++) {
      const demoPayload = `demo-login:user${stockCount}@example.com|password:Demo${stockCount}!Pass`
      await prisma.stockItem.create({
        data: {
          planId: plan.id,
          payloadEnc: encryptPayload(demoPayload, key),
          status: StockStatus.AVAILABLE
        }
      })
      stockCount++
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  await prisma.setting.upsert({
    where: { key: 'stars_usd_rate' },
    update: { value: '0.013' },
    create: { key: 'stars_usd_rate', value: '0.013' }
  })
  await prisma.setting.upsert({
    where: { key: 'min_topup_cents' },
    update: { value: 500 },
    create: { key: 'min_topup_cents', value: 500 }
  })
  await prisma.setting.upsert({
    where: { key: 'support_url' },
    update: { value: 'https://t.me/tgshop_support' },
    create: { key: 'support_url', value: 'https://t.me/tgshop_support' }
  })
  await prisma.setting.upsert({
    where: { key: 'referral_percent' },
    update: { value: 5 },
    create: { key: 'referral_percent', value: 5 }
  })

  // ── Default admin user ───────────────────────────────────────────────────
  // NOTE: this is a demo-only bcrypt-shaped placeholder hash, NOT a real bcrypt
  // hash (no bcrypt dependency in this package). Replace via the admin app's
  // real auth flow before relying on this account; treat as seed data only.
  const demoPasswordHash = `seed$${hash('sha256', 'ChangeMe123!').toString()}`
  await prisma.adminUser.upsert({
    where: { email: 'admin@tgshop.local' },
    update: {},
    create: {
      email: 'admin@tgshop.local',
      passwordHash: demoPasswordHash,
      role: AdminRole.OWNER
    }
  })

  console.log(
    `Seed complete: ${categories.length} categories, ${products.length} products, ${plans.length} plans, ${stockCount} stock items.`
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
