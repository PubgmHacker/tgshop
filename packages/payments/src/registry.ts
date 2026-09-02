import { z } from 'zod'
import type { PaymentProvider, PaymentProviderId } from './types.js'
import { CryptoBotConfigSchema, createCryptoBotProvider, type CryptoBotDeps } from './cryptobot.js'
import { StarsConfigSchema, createStarsProvider, type StarsDeps } from './stars.js'
import { PaymentConfigError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Provider registry + config schemas.
//
// Each provider's runtime config is expected to be stored as a `Setting` row
// (key: `payment_provider:<id>`, value: JSON matching the schema below).
// Adding a new provider = new adapter file + a new entry here + a new
// Setting row; no other code needs to change.
// ─────────────────────────────────────────────────────────────────────────────

export const ProviderConfigSchemas = {
  cryptobot: CryptoBotConfigSchema,
  stars: StarsConfigSchema
} as const

export type ProviderConfigMap = {
  cryptobot: z.infer<typeof CryptoBotConfigSchema>
  stars: z.infer<typeof StarsConfigSchema>
}

export interface RegistryDeps {
  cryptobot?: CryptoBotDeps
  stars?: StarsDeps
}

/**
 * Builds a live PaymentProvider instance for `id` from its config (already
 * parsed via the matching ProviderConfigSchemas entry) and optional deps
 * (test doubles for fetch/time/state).
 */
export function getProvider<Id extends PaymentProviderId>(
  id: Id,
  config: ProviderConfigMap[Id],
  deps: RegistryDeps = {}
): PaymentProvider {
  switch (id) {
    case 'cryptobot':
      return createCryptoBotProvider(config as ProviderConfigMap['cryptobot'], deps.cryptobot)
    case 'stars':
      return createStarsProvider(config as ProviderConfigMap['stars'], deps.stars)
    default: {
      const exhaustiveCheck: never = id
      throw new PaymentConfigError(`Unknown payment provider id: ${String(exhaustiveCheck)}`)
    }
  }
}

/** Parses+validates a raw Setting `value` JSON blob for provider `id`. */
export function parseProviderConfig<Id extends PaymentProviderId>(
  id: Id,
  rawValue: unknown
): ProviderConfigMap[Id] {
  const schema = ProviderConfigSchemas[id]
  return schema.parse(rawValue) as ProviderConfigMap[Id]
}
