// Placeholder environment for the worker's unit tests.
//
// Nothing under test here reads these values — they are required because
// src/logger.ts calls loadEnv() at module load, and queue.ts imports the
// logger. Without them, importing the module under test throws before a single
// assertion runs.
//
// Set only when absent, so the real environment still wins: `set -a; . ./.env;
// set +a` and CI's own env block both stay authoritative. The values are
// deliberately unroutable/invalid — if any test ever does open a connection,
// it must fail loudly rather than quietly reach a real database or bot.
const PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit_tests_never_connect?schema=public',
  REDIS_URL: 'redis://127.0.0.1:1',
  ENCRYPTION_KEY: '0'.repeat(63) + '1',
  BOT_TOKEN: '000000:UNIT-TEST-PLACEHOLDER-TOKEN',
  NODE_ENV: 'test'
}

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  if (process.env[key] === undefined) process.env[key] = value
}
