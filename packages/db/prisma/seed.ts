import { randomBytes, createCipheriv, hash } from 'node:crypto'
import { PrismaClient, DeliveryType, StockStatus, AdminRole } from '@prisma/client'

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

  await prisma.plan.updateMany({
    where: {
      product: {
        slug: {
          in: [
            'netflix-premium',
            'spotify-premium',
            'steam-wallet-code',
            'pubg-mobile-uc',
            'windows-11-pro-key',
            'office-2021-key'
          ]
        }
      }
    },
    data: { isActive: false }
  })
  await prisma.product.updateMany({
    where: {
      slug: {
        in: [
          'netflix-premium',
          'spotify-premium',
          'steam-wallet-code',
          'pubg-mobile-uc',
          'windows-11-pro-key',
          'office-2021-key'
        ]
      }
    },
    data: { isActive: false }
  })
  await prisma.category.updateMany({
    where: { slug: { in: ['streaming', 'gaming', 'software'] } },
    data: { isActive: false }
  })

  // ── Categories ──────────────────────────────────────────────────────────
  const categoriesData = [
    { title: 'Чат', slug: 'chat', emoji: null, sortOrder: 0 },
    { title: 'Картинки', slug: 'image', emoji: null, sortOrder: 1 },
    { title: 'Код', slug: 'code', emoji: null, sortOrder: 2 }
  ]

  const categories = []
  for (const data of categoriesData) {
    const category = await prisma.category.upsert({
      where: { slug: data.slug },
      update: { ...data, isActive: true },
      create: { ...data, isActive: true }
    })
    categories.push(category)
  }

  const [chat, image, code] = categories
  if (!chat || !image || !code) {
    throw new Error('failed to seed categories')
  }

  // ── Products (7) ────────────────────────────────────────────────────────
  const productsData = [
    {
      categoryId: chat.id,
      title: 'ChatGPT Plus',
      slug: 'chatgpt-plus',
      description: 'Подписка ChatGPT Plus: GPT-4o, приоритетный доступ, DALL·E.',
      deliveryType: DeliveryType.STOCK_POOL,
      sortOrder: 0
    },
    {
      categoryId: chat.id,
      title: 'Claude Pro',
      slug: 'claude-pro',
      description: 'Anthropic Claude Pro: длинный контекст, Projects, приоритет.',
      deliveryType: DeliveryType.STOCK_POOL,
      sortOrder: 1
    },
    {
      categoryId: image.id,
      title: 'Midjourney',
      slug: 'midjourney',
      description: 'Подписка Midjourney: генерация изображений в Discord.',
      deliveryType: DeliveryType.UNIQUE_CODE,
      sortOrder: 0
    },
    {
      categoryId: image.id,
      title: 'Flux Pro',
      slug: 'flux-pro',
      description: 'Доступ к Flux Pro для генерации изображений.',
      deliveryType: DeliveryType.UNIQUE_CODE,
      sortOrder: 1
    },
    {
      categoryId: code.id,
      title: 'Mirasim',
      slug: 'mirasim',
      description:
        'Mirasim — IDE для agentic coding и eval. Доступ оформляется оператором вручную.',
      imageUrl: 'https://mirasim.ai/site/mirasim-mark-white.png',
      deliveryType: DeliveryType.MANUAL_FALLBACK,
      externalConfig: { sourceUrl: 'https://mirasim.ai', fulfillmentMode: 'manual' },
      sortOrder: 0
    },
    {
      categoryId: code.id,
      title: 'GitHub Copilot',
      slug: 'github-copilot',
      description: 'GitHub Copilot: автодополнение кода в IDE.',
      deliveryType: DeliveryType.UNIQUE_CODE,
      sortOrder: 1
    },
    {
      categoryId: code.id,
      title: 'Cursor Pro',
      slug: 'cursor-pro',
      description: 'Cursor Pro: агентный редактор с доступом к моделям.',
      deliveryType: DeliveryType.STOCK_POOL,
      sortOrder: 2
    }
  ]

  const products = []
  for (const data of productsData) {
    const product = await prisma.product.upsert({
      where: { slug: data.slug },
      update: { ...data, isActive: true },
      create: { ...data, isActive: true }
    })
    products.push(product)
  }

  // ── Plans ────────────────────────────────────────────────────────────────
  const plans = []
  for (const product of products) {
    // Mirasim is intentionally manual until a licensed supplier/invite-code
    // integration is configured. Do not create fake stock for it.
    if (product.slug === 'mirasim') {
      const plan = await prisma.plan.upsert({
        where: { id: 'mirasim-pro-1m' },
        update: {
          productId: product.id,
          title: 'Mirasim Pro · 1 месяц',
          durationDays: 30,
          priceCents: 2900,
          priceStars: null,
          discountPercent: 0,
          lowStockThreshold: 0,
          isActive: true,
          sortOrder: 0
        },
        create: {
          id: 'mirasim-pro-1m',
          productId: product.id,
          title: 'Mirasim Pro · 1 месяц',
          durationDays: 30,
          priceCents: 2900,
          priceStars: null,
          discountPercent: 0,
          lowStockThreshold: 0,
          isActive: true,
          sortOrder: 0
        }
      })
      plans.push(plan)
      continue
    }

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

  // ── Stock items (2 per active pool-backed plan, encrypted) ───────────────
  // StockItem has no natural unique column, and payloadEnc cannot serve as one
  // (a fresh IV per encrypt means the same plaintext yields different ciphertext
  // each run). So the deterministic id is derived from (plan.id, index): keying
  // on the plan — not on a payload-only hash — means that after a catalog change
  // (e.g. swapping the old streaming/gaming products for these AI ones) a re-seed
  // provisions fresh stock for the NEW plans instead of colliding on an id that
  // still points at a now-inactive plan. update:{} stays empty so a re-seed never
  // yanks a row back to AVAILABLE after a real order already consumed it.
  let stockCount = 0
  for (const plan of plans) {
    const product = products.find((item) => item.id === plan.productId)
    if (product?.deliveryType === DeliveryType.MANUAL_FALLBACK) continue
    const itemsForPlan = 2
    for (let i = 0; i < itemsForPlan; i++) {
      const demoPayload = `demo-login:${plan.id}-${i}@example.com|password:Demo${i}!Pass`
      const seedId = `seed-stock-${plan.id}-${i}`
      await prisma.stockItem.upsert({
        where: { id: seedId },
        update: {},
        create: {
          id: seedId,
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
    update: {},
    create: { key: 'stars_usd_rate', value: '0.013' }
  })
  await prisma.setting.upsert({
    where: { key: 'min_topup_cents' },
    update: {},
    create: { key: 'min_topup_cents', value: 500 }
  })
  await prisma.setting.upsert({
    where: { key: 'support_url' },
    update: {},
    create: { key: 'support_url', value: 'https://t.me/tgshop_support' }
  })
  await prisma.setting.upsert({
    where: { key: 'referral_percent' },
    update: {},
    create: { key: 'referral_percent', value: 5 }
  })
  await prisma.setting.upsert({
    where: { key: 'refund_auto_approve_ceiling_cents' },
    update: {},
    create: { key: 'refund_auto_approve_ceiling_cents', value: 1000 }
  })
  await prisma.setting.upsert({
    where: { key: 'manual_fallback_sla_minutes' },
    update: {},
    create: { key: 'manual_fallback_sla_minutes', value: 60 }
  })
  await prisma.setting.upsert({
    where: { key: 'broadcast_rate_per_sec' },
    update: {},
    create: { key: 'broadcast_rate_per_sec', value: 25 }
  })
  await prisma.setting.upsert({
    where: { key: 'new_product_auto_broadcast' },
    update: {},
    create: { key: 'new_product_auto_broadcast', value: false }
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
