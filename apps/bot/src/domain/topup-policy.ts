import { getSetting } from '@tgshop/core'
import { prisma } from '@tgshop/db'
import { redis } from '../config/redis.js'

/** Hard ceiling protects both the provider and the operator from typo-sized top-ups. */
export const MAX_TOPUP_CENTS = 1_000_000

export interface TopupLimits {
  minCents: number
  maxCents: number
}

/** Reads the operator-controlled minimum while keeping the ceiling code-owned. */
export async function getTopupLimits(): Promise<TopupLimits> {
  return {
    minCents: await getSetting(prisma, 'min_topup_cents', redis),
    maxCents: MAX_TOPUP_CENTS
  }
}
