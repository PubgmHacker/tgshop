// ─────────────────────────────────────────────────────────────────────────────
// @tgshop/core — pure domain logic. No framework imports (no Fastify, grammY or
// Next); the only I/O is through a Prisma client/transaction or an ioredis
// client handed in by the caller, never opened here.
//
// Every module is re-exported flat: consumers write
// `import { computeOrderTotal } from '@tgshop/core'`.
// ─────────────────────────────────────────────────────────────────────────────

export * from './errors.js'
export * from './money.js'
export * from './crypto.js'
export * from './ledger.js'
export * from './pricing.js'
export * from './orders.js'
export * from './delivery.js'
export * from './manual-delivery.js'
export * from './supplier.js'
export * from './fulfillment.js'
export * from './stock.js'
export * from './subscriptions.js'
export * from './referrals.js'
export * from './events.js'
export * from './settings.js'
export * from './content.js'
export * from './tron-address.js'
