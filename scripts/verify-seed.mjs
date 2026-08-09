// Smoke-check that the seed landed and that a StockItem payload encrypted by
// packages/db/prisma/seed.ts decrypts with @tgshop/core's key/format — the two
// implementations must stay byte-compatible or delivery silently breaks.
import { prisma } from '../packages/db/dist/index.js'
import { decrypt } from '../packages/core/dist/index.js'

const [cats, prods, plans, stock, admins] = await Promise.all([
  prisma.category.count(), prisma.product.count(), prisma.plan.count(),
  prisma.stockItem.count(), prisma.adminUser.count()
])
console.log(`categories=${cats} products=${prods} plans=${plans} stock=${stock} admins=${admins}`)
const settings = await prisma.setting.findMany()
console.log('settings:', settings.map(s => `${s.key}=${JSON.stringify(s.value)}`).join(', '))
const item = await prisma.stockItem.findFirst()
console.log('decrypted stock payload:', JSON.stringify(decrypt(item.payloadEnc)))
await prisma.$disconnect()
