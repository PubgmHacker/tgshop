import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prisma } from './setup.js'

const stockSql = readFileSync(new URL('../../packages/db/prisma/migrations/20260905100000_remove_unclaimed_seed_stock/migration.sql', import.meta.url), 'utf8')
const adminSql = readFileSync(new URL('../../packages/db/prisma/migrations/20260905110000_remove_seed_admin/migration.sql', import.meta.url), 'utf8')

describe('legacy seed cleanup migration boundaries', () => {
  it('preserves repaired admins and reserved, sold, or operator-created stock', async () => {
    await prisma.$transaction(async (tx) => {
      // Temporary tables shadow public tables only for this connection; no
      // deployment records are touched by the migration regression test.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE stock_items (id text, "planId" text, status text, "orderId" text, "reservedUntil" timestamp) ON COMMIT DROP')
      await tx.$executeRawUnsafe('CREATE TEMP TABLE admin_users (email text, "passwordHash" text) ON COMMIT DROP')
      await tx.$executeRawUnsafe(`INSERT INTO stock_items VALUES
        ('seed-stock-a-0','a','AVAILABLE',NULL,NULL),
        ('seed-stock-a-1','a','SOLD','order-1',NULL),
        ('seed-stock-b-0','b','RESERVED',NULL,now()),
        ('seed-stock-custom','a','AVAILABLE',NULL,NULL),
        ('operator-stock','a','AVAILABLE',NULL,NULL)`)
      const legacyHash = 'seed$9a4aabf0e5cf71cae2cea646613ce7e2a5919fa758e56819704be25a3a2c1f0b'
      await tx.$executeRaw`INSERT INTO admin_users VALUES ('admin@tgshop.local', ${legacyHash}), ('admin@tgshop.local', 'real-bcrypt-hash'), ('owner@example.test', 'real-bcrypt-hash')`
      await tx.$executeRawUnsafe(stockSql)
      await tx.$executeRawUnsafe(adminSql)
      const stock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM stock_items ORDER BY id`
      expect(stock.map((row) => row.id)).toEqual(['operator-stock', 'seed-stock-a-1', 'seed-stock-b-0', 'seed-stock-custom'])
      const admins = await tx.$queryRaw<Array<{ passwordHash: string }>>`SELECT "passwordHash" FROM admin_users`
      expect(admins).toHaveLength(2)
      expect(admins.every((row) => row.passwordHash === 'real-bcrypt-hash')).toBe(true)
    })
  })
})
