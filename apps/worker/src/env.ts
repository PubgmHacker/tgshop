import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Environment schema for @tgshop/worker. Fails fast on boot if misconfigured.
// ─────────────────────────────────────────────────────────────────────────────

// A SUN/USDT amount carried as a decimal string so it can be parsed into a
// BigInt without ever passing through a float. Rejects anything non-numeric at
// boot rather than throwing deep inside the sweeper.
const integerString = (label: string) =>
  z
    .string()
    .regex(/^\d+$/, `${label} must be a non-negative integer string (no decimals, no separators)`)

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

  // TRON chain scanning
  TRONGRID_API_BASE: z.string().default('https://api.trongrid.io'),
  TRONGRID_API_KEY: z.string().optional(),
  TRON_USDT_CONTRACT: z.string().default('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  TRON_MIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(19),
  TRON_SWEEP_TO_ADDRESS: z.string().optional(),
  TRON_SWEEP_THRESHOLD: z.string().default('0'), // USDT 6-decimals, as string (BigInt)
  TRON_SWEEP_READ_ONLY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  TRON_LOW_TRX_THRESHOLD: z.string().default('50000000'), // 50 TRX in sun

  // ── TRON sweeping key material ──────────────────────────────────────────
  // Account-level extended PUBLIC key at m/44'/195'/0'. Derives deposit
  // addresses; cannot spend from them.
  TRON_MASTER_XPUB: z.string().optional(),
  // Account-level extended PRIVATE key at m/44'/195'/0', stored as an
  // AES-256-GCM `v1:iv:tag:ct` blob encrypted under ENCRYPTION_KEY. Required
  // for live sweeping: only this can sign transfers OUT of a deposit address.
  // Absent => the sweeper stays in read-only (manual sweep) mode.
  TRON_MASTER_XPRV: z.string().optional(),
  // Hot wallet private key (same `v1:iv:tag:ct` encrypted format). Funds the
  // TRX energy top-ups that let a fresh deposit address pay for its own
  // TRC-20 transfer. Not used to sign the sweep itself.
  TRON_HOT_WALLET_KEY: z.string().optional(),

  // ── TRON sweeping energy policy (all values in SUN, 1 TRX = 1_000_000) ──
  // TRX a deposit address must hold before we attempt a TRC-20 transfer.
  // ~65k energy worst case * 420 sun/energy = ~27.3 TRX.
  TRON_SWEEP_ENERGY_RESERVE_SUN: integerString('TRON_SWEEP_ENERGY_RESERVE_SUN').default('27000000'),
  // TRX sent to a deposit address that is below the reserve (adds bandwidth headroom).
  TRON_SWEEP_TOPUP_SUN: integerString('TRON_SWEEP_TOPUP_SUN').default('30000000'),
  // TRX the hot wallet must still hold after funding a top-up, or we refuse to spend.
  TRON_SWEEP_HOT_WALLET_FLOOR_SUN: integerString('TRON_SWEEP_HOT_WALLET_FLOOR_SUN').default('50000000'),
  // Hard cap on TRX burnt for energy by a single sweep transfer.
  TRON_SWEEP_FEE_LIMIT_SUN: integerString('TRON_SWEEP_FEE_LIMIT_SUN').default('40000000'),
  // How long to wait for a top-up to land before giving up on this address.
  TRON_SWEEP_TOPUP_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  TRON_SWEEP_TOPUP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),

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
