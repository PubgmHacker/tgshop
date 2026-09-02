import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Environment schema for @tgshop/worker. Fails fast on boot if misconfigured.
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),

  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  ADMIN_IDS: z
    .string()
    .default('')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => BigInt(s))
    ),

  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3100),

  // CryptoBot fallback polling
  CRYPTOBOT_API_TOKEN: z.string().optional(),
  CRYPTOBOT_API_BASE: z.string().default('https://pay.crypt.bot/api'),

  // TRON chain scanning (read-only: customers pay into the owner's own wallet)
  TRONGRID_API_BASE: z.string().default('https://api.trongrid.io'),
  TRONGRID_API_KEY: z.string().optional(),
  TRON_USDT_CONTRACT: z.string().default('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  TRON_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(19),
  // The static USDT-TRC20 address every customer pays into. TRON_SWEEP_TO_ADDRESS
  // is the name the deployment already carries from the retired sweep design;
  // TRON_RECEIVE_ADDRESS wins when both are set.
  TRON_RECEIVE_ADDRESS: z.string().optional(),
  TRON_SWEEP_TO_ADDRESS: z.string().optional(),

  // Broadcast
  BROADCAST_MAX_MSGS_PER_SEC: z.coerce.number().int().positive().default(25),

  // Subscriptions
  SUBS_AUTO_RENEW_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true')
})

export type WorkerEnv = z.infer<typeof envSchema>

let cached: WorkerEnv | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  if (cached) return cached
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid worker environment: ${message}`)
  }
  cached = parsed.data
  return cached
}
