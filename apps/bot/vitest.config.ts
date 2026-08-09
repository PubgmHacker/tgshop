import { defineConfig } from 'vitest/config'

// Unit tests only — nothing here touches Postgres, Redis or Telegram. The
// bot's stateful behaviour is covered elsewhere (scripts/verify-api.mjs for
// route registration and auth guards, @tgshop/e2e for delivery and the
// ledger), so these files stay fast and dependency-free.
//
// setup-env.ts has to run first: src/config/env.ts calls loadEnv() at module
// load and process.exit(1)s on a validation failure, which would kill the
// vitest runner rather than fail a test. See that file for why the placeholder
// values look the way they do.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup-env.ts'],
    environment: 'node'
  }
})
