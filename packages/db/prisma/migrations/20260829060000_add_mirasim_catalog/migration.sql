-- Seed the first Mirasim offer without touching existing products, orders, or
-- operator-managed settings. The bot container runs `prisma migrate deploy` on
-- boot, so a production database receives the catalog entry automatically.

INSERT INTO "categories" ("id", "title", "slug", "emoji", "sortOrder", "isActive")
VALUES ('seed-category-code', 'Код', 'code', NULL, 2, true)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "products" (
  "id",
  "categoryId",
  "title",
  "slug",
  "description",
  "imageUrl",
  "deliveryType",
  "externalConfig",
  "isActive",
  "sortOrder"
)
SELECT
  'seed-product-mirasim',
  "id",
  'Mirasim',
  'mirasim',
  'Mirasim — IDE для agentic coding и eval. Доступ оформляется оператором вручную.',
  'https://mirasim.ai/site/mirasim-mark-white.png',
  'MANUAL_FALLBACK',
  '{"sourceUrl":"https://mirasim.ai","fulfillmentMode":"manual"}'::jsonb,
  true,
  0
FROM "categories"
WHERE "slug" = 'code'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "plans" (
  "id",
  "productId",
  "title",
  "durationDays",
  "priceCents",
  "priceStars",
  "discountPercent",
  "lowStockThreshold",
  "isActive",
  "sortOrder"
)
SELECT
  'mirasim-pro-1m',
  "id",
  'Mirasim Pro · 1 месяц',
  30,
  2900,
  NULL,
  0,
  0,
  true,
  0
FROM "products"
WHERE "slug" = 'mirasim'
ON CONFLICT ("id") DO NOTHING;
