import { prisma } from '@tgshop/db'
import { getBalance } from '@tgshop/core'
import { emitEvent } from './events.js'

/** Finds or creates the internal User row for a Telegram user, applying referral/promo deep-link context on first sight. */
export async function findOrCreateUser(input: {
  tgId: bigint
  username?: string | null
  firstName?: string | null
  languageCode?: string | null
  referredByTgId?: bigint | null
}) {
  const existing = await prisma.user.findUnique({ where: { tgId: input.tgId } })
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username: input.username ?? existing.username,
        firstName: input.firstName ?? existing.firstName,
        languageCode: input.languageCode ?? existing.languageCode
      }
    })
  }

  let referredById: string | null = null
  if (input.referredByTgId) {
    const referrer = await prisma.user.findUnique({ where: { tgId: input.referredByTgId } })
    if (referrer) referredById = referrer.id
  }

  const user = await prisma.user.create({
    data: {
      tgId: input.tgId,
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      languageCode: input.languageCode ?? null,
      referredById
    }
  })

  // user.registered is emitted here rather than in each entry point (/start,
  // Mini App auth, checkout, top-up) so it fires exactly once per genuinely new
  // user, on whichever surface saw them first. A returning visitor takes the
  // update branch above and never reaches this line, which is what keeps the
  // event a registration rather than a visit.
  //
  // The row is already committed — a single prisma.create is its own
  // transaction — so the event cannot be describing something later rolled back.
  await emitEvent('user.registered', {
    userId: user.id,
    tgId: user.tgId.toString(),
    referredById: user.referredById
  })

  return user
}

export async function getUserByTgId(tgId: bigint) {
  return prisma.user.findUnique({ where: { tgId } })
}

export async function getUserBalance(userId: string): Promise<number> {
  return getBalance(prisma, userId)
}

export async function getUserTotalSpentCents(userId: string): Promise<number> {
  const result = await prisma.order.aggregate({
    where: { userId, status: { in: ['DELIVERED', 'PAID', 'DELIVERING'] } },
    _sum: { amountCents: true }
  })
  return result._sum.amountCents ?? 0
}

export async function getReferralStats(userId: string) {
  const referrals = await prisma.user.count({ where: { referredById: userId } })
  const earnings = await prisma.balanceTransaction.aggregate({
    where: { userId, type: 'REFERRAL' },
    _sum: { amountCents: true }
  })
  return { count: referrals, earningsCents: earnings._sum.amountCents ?? 0 }
}

/**
 * Builds the referral deep link. The payload carries the referrer's Telegram
 * id, NOT our internal User.id: `handlers/start.ts` parses `ref_<n>` as a
 * BigInt and `@tgshop/core`'s attachReferrer() takes a referrerTgId, so a cuid
 * here would throw on parse and silently drop every referral.
 */
export function buildReferralLink(botUsername: string, referrerTgId: bigint): string {
  return `https://t.me/${botUsername}?start=ref_${referrerTgId.toString()}`
}

export function referralIdempotencyKey(orderId: string): string {
  return `referral:${orderId}`
}
