import { PrismaClient, DeliveryType } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
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
      update: {},
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
      update: {},
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
        update: {},
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

  // Stock is intentionally empty after a seed. Operators add encrypted
  // production payloads through the admin stock flow.

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

  const stockCount = 0
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
