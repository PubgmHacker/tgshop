import { PrismaClient } from '@prisma/client'

// Singleton PrismaClient with global caching in dev to avoid exhausting the
// Postgres connection pool during hot-reloads (tsx watch / next dev).

declare global {
  // eslint-disable-next-line no-var
  var __tgshopPrisma: PrismaClient | undefined
}

export const prisma: PrismaClient =
  globalThis.__tgshopPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__tgshopPrisma = prisma
}

export default prisma

export * from '@prisma/client'
