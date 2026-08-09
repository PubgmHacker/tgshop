import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Central, validated environment configuration for @tgshop/bot.
// Fails fast at boot with a clear message if anything required is missing.
// ─────────────────────────────────────────────────────────────────────────────

const idListSchema = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => BigInt(x))
  )

/**
 * Treats an empty (or whitespace-only) env var as absent before validating.
 * `FOO=` in a .env file arrives as `''`, which would otherwise fail schemas
 * like `.url()` instead of falling through to the optional/default branch.
 */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, T['_output']> {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema
  ) as unknown as z.ZodEffects<T, T['_output']>
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  BOT_USERNAME: z.string().min(1, 'BOT_USERNAME is required'),
  // Optional on purpose: when unset the bot runs in long-polling mode (dev).
  // When set, index.ts switches to webhook mode and registers it with Telegram.
  // An EMPTY string is treated as unset — blanking `WEBHOOK_URL=` in .env is
  // the natural way to turn webhook mode off, and must not fail url() parsing.
  WEBHOOK_URL: emptyAsUndefined(z.string().url().optional()),
  WEBHOOK_SECRET: z.string().min(16, 'WEBHOOK_SECRET must be at least 16 chars'),
  ADMIN_IDS: idListSchema,

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  ENCRYPTION_KEY: z.string().min(1),
  SERVICE_TOKEN: z.string().min(16, 'SERVICE_TOKEN must be at least 16 chars'),

  CRYPTOBOT_API_TOKEN: z.string().optional().default(''),
  CRYPTOBOT_WEBHOOK_SECRET: z.string().optional().default(''),
  CRYPTOBOT_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),

  STARS_USD_RATE: z.string().default('0.013'),

  TRON_NETWORK: z.enum(['mainnet', 'nile', 'shasta']).default('nile'),
  TRONGRID_API_KEY: z.string().optional().default(''),
  TRON_MASTER_XPUB: z.string().optional().default(''),
  TRON_USDT_CONTRACT: z.string().optional().default(''),
  TRON_MIN_CONFIRMATIONS: z.coerce.number().int().positive().default(19),

  PRICE_ORACLE_URL: z.string().optional().default(''),
  MINIAPP_URL: z.string().url(),
  LANDING_URL: z.string().url(),
  ADMIN_URL: z.string().url(),
  SENTRY_DSN: z.string().optional().default(''),

  NEXT_PUBLIC_BOT_USERNAME: z.string().optional().default('')
})

export type BotEnv = z.infer<typeof envSchema>

function loadEnv(): BotEnv {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`)
    process.exit(1)
  }
  return parsed.data
}

export const env: BotEnv = loadEnv()

export const isAdminId = (tgId: bigint): boolean => env.ADMIN_IDS.some((id) => id === tgId)
