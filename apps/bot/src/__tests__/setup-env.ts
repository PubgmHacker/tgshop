// Placeholder environment for the bot's unit tests.
//
// Nothing under test here reads these values for their content — they are
// required because src/config/env.ts calls loadEnv() at module load, and
// src/server/auth.ts imports `env` for JWT_SECRET. Worse than the worker's
// case: this loader calls process.exit(1) on a validation failure rather than
// throwing, which would tear down the vitest runner itself with no usable
// error. The vars must be present before the first import.
//
// Set only when absent, so the real environment still wins: `set -a; . ./.env;
// set +a` and CI's own env block both stay authoritative. The values are
// deliberately unroutable/invalid — if any test ever does open a connection,
// it must fail loudly rather than quietly reach a real database or bot.
//
// BOT_TOKEN is the one value tests DO depend on, since the initData HMAC is
// keyed by it; the auth tests derive their expected hashes from this exact
// string. Mirrors apps/worker/src/__tests__/setup-env.ts.
const PLACEHOLDERS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit_tests_never_connect?schema=public',
  REDIS_URL: 'redis://127.0.0.1:1',
  ENCRYPTION_KEY: '0'.repeat(63) + '1',
  BOT_TOKEN: '000000:UNIT-TEST-PLACEHOLDER-TOKEN',
  BOT_USERNAME: 'unit_test_placeholder_bot',
  // These three have minimum-length rules in the schema (16 chars).
  JWT_SECRET: 'unit-test-jwt-secret-not-for-prod',
  WEBHOOK_SECRET: 'unit-test-webhook-secret-not-for-prod',
  SERVICE_TOKEN: 'unit-test-service-token-not-for-prod',
  // Parsed with .url(); absent values fail validation outright.
  MINIAPP_URL: 'https://miniapp.unit.invalid',
  LANDING_URL: 'https://unit.invalid',
  ADMIN_URL: 'https://admin.unit.invalid'
}

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  if (process.env[key] === undefined) process.env[key] = value
}
