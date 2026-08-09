import { defineConfig } from 'vitest/config'

// Unit tests only — nothing here touches Postgres, Redis or Telegram. The
// worker's stateful behaviour is covered end-to-end elsewhere (scripts/
// verify-broadcast.mjs for the queue contract, @tgshop/e2e for delivery and
// the ledger), so these files stay fast and dependency-free and can run in
// parallel with everything else in CI.
//
// setup-env.ts still has to run first: src/logger.ts calls loadEnv() at module
// load and queue.ts imports it, so importing the module under test throws
// before any assertion unless the required vars are present. The placeholders
// it sets are unroutable on purpose — see the file for why.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup-env.ts'],
    environment: 'node'
  }
})
