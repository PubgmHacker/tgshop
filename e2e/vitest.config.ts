import { defineConfig } from 'vitest/config'

// ─────────────────────────────────────────────────────────────────────────────
// These tests talk to a REAL Postgres. Two consequences shape this config:
//
// 1. Everything is sequential. Every file shares one database, and the stock
//    concurrency test asserts exact pool counts — a second file creating or
//    consuming rows in parallel would make those counts non-deterministic.
//    (The concurrency *inside* a test is driven with Promise.all, which is
//    unaffected by running files one at a time.)
// 2. Timeouts are generous. A cold Prisma client has to spin up a query engine
//    and open a connection pool before the first statement runs.
//
// setupFiles run in order, and `load-env.ts` MUST come first: it populates
// DATABASE_URL / ENCRYPTION_KEY before anything imports @tgshop/db, which
// instantiates a PrismaClient at module load.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/load-env.ts', './src/vitest.setup.ts'],
    fileParallelism: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        minThreads: 1,
        maxThreads: 1
      }
    },
    sequence: {
      concurrent: false,
      shuffle: false
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    retry: 0
  }
})
