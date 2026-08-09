import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ENCRYPTION_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  BOT_TOKEN: z.string().optional(),
  BOT_USERNAME: z.string().optional(),
  BROADCAST_QUEUE_NAME: z.string().default('broadcast'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
})

export type AdminEnv = z.infer<typeof envSchema>

let cached: AdminEnv | null = null

/** Lazily validates and caches process.env against the admin app's required shape. */
export function getEnv(): AdminEnv {
  if (cached) return cached
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Invalid admin environment: ${parsed.error.message}`)
  }
  cached = parsed.data
  return cached
}
