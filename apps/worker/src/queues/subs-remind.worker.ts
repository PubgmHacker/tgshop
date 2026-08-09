import type { Job } from 'bullmq'
import { prisma, SubStatus, OrderStatus, PaymentProvider, LedgerType } from '@tgshop/db'
import { debit } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'
import { loadEnv } from '../env.js'

// ─────────────────────────────────────────────────────────────────────────────
// subs:remind — repeatable job. For each ACTIVE subscription:
//   - expiring in ~3 days and not yet reminded at the 3-day mark: send a
//     reminder with a one-tap renew button.
//   - expiring in ~1 day: send an urgent reminder.
//   - already expired: mark EXPIRED; if autoRenew is on, attempt to debit the
//     plan price from balance and create a fresh renewal Order + Subscription;
//     otherwise leave expired (user must renew manually).
// remindedAt tracks only the most recent reminder sent, to avoid duplicate
// sends within the same day when the sweep runs more than once daily.
// ─────────────────────────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly
const DAY_MS = 24 * 60 * 60 * 1000

export async function registerSubsRemindRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.SubsRemind, 'subs-remind-sweep', SWEEP_INTERVAL_MS)
}

async function processSubsRemind(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.SubsRemind, job.id, correlationId)
  const now = new Date()

  const active = await prisma.subscription.findMany({
    where: { status: SubStatus.ACTIVE },
    include: { user: true, plan: true }
  })

  let remindedCount = 0
  let expiredCount = 0
  let renewedCount = 0

  for (const sub of active) {
    try {
      const msUntilExpiry = sub.expiresAt.getTime() - now.getTime()

      if (msUntilExpiry <= 0) {
        const renewed = await tryExpireOrRenew(sub, log)
        expiredCount += 1
        if (renewed) renewedCount += 1
        continue
      }

      const daysUntilExpiry = Math.ceil(msUntilExpiry / DAY_MS)
      const alreadyRemindedToday =
        sub.remindedAt !== null && now.getTime() - sub.remindedAt.getTime() < DAY_MS

      if (alreadyRemindedToday) continue

      if (daysUntilExpiry === 3 || daysUntilExpiry === 1) {
        await sendReminder(sub, daysUntilExpiry === 1 ? 'urgent' : 'normal')
        await prisma.subscription.update({ where: { id: sub.id }, data: { remindedAt: now } })
        remindedCount += 1
      }
    } catch (err) {
      log.error({ err, subscriptionId: sub.id }, 'subs:remind failed to process subscription')
    }
  }

  log.info({ remindedCount, expiredCount, renewedCount }, 'subs:remind sweep complete')
}

async function sendReminder(
  sub: Awaited<ReturnType<typeof prisma.subscription.findMany>>[number] & {
    user: { languageCode: string | null; tgId: bigint }
    plan: { title: string }
  },
  urgency: 'normal' | 'urgent'
): Promise<void> {
  const locale = resolveLocale(sub.user.languageCode)
  const strings = t(locale)
  const expiresAtDisplay = sub.expiresAt.toISOString().slice(0, 10)
  const text =
    urgency === 'urgent'
      ? strings.subReminder1Day(sub.plan.title, expiresAtDisplay)
      : strings.subReminder3Day(sub.plan.title, expiresAtDisplay)
  await sendTelegramMessage(sub.user.tgId, text, {
    buttons: [[{ text: strings.subRenewButton, callbackData: `renew_sub:${sub.id}` }]]
  })
}

async function tryExpireOrRenew(
  sub: Awaited<ReturnType<typeof prisma.subscription.findMany>>[number] & {
    user: { languageCode: string | null; tgId: bigint }
    plan: { title: string; priceCents: number; durationDays: number | null }
  },
  log: ReturnType<typeof jobLogger>
): Promise<boolean> {
  const env = loadEnv()
  const locale = resolveLocale(sub.user.languageCode)

  if (!sub.autoRenew || !env.SUBS_AUTO_RENEW_ENABLED) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: SubStatus.EXPIRED } })
    return false
  }

  try {
    const durationDays = sub.plan.durationDays ?? 30
    const idempotencyKey = `sub-autorenew:${sub.id}:${sub.expiresAt.toISOString()}`

    await prisma.$transaction(async (tx) => {
      await debit(tx, {
        userId: sub.userId,
        amountCents: sub.plan.priceCents,
        type: LedgerType.PURCHASE,
        idempotencyKey,
        comment: `Auto-renew subscription ${sub.id}`
      })

      const newOrder = await tx.order.create({
        data: {
          userId: sub.userId,
          planId: sub.planId,
          qty: 1,
          amountCents: sub.plan.priceCents,
          currency: 'USD',
          provider: PaymentProvider.BALANCE,
          status: OrderStatus.PAID,
          idempotencyKey: `${idempotencyKey}:order`,
          paidAt: new Date()
        }
      })

      const startsAt = sub.expiresAt.getTime() > Date.now() ? sub.expiresAt : new Date()
      const expiresAt = new Date(startsAt.getTime() + durationDays * DAY_MS)

      await tx.subscription.update({ where: { id: sub.id }, data: { status: SubStatus.EXPIRED } })
      await tx.subscription.create({
        data: {
          userId: sub.userId,
          planId: sub.planId,
          orderId: newOrder.id,
          startsAt,
          expiresAt,
          autoRenew: true,
          status: SubStatus.ACTIVE
        }
      })
    })

    await sendTelegramMessage(sub.user.tgId, t(locale).subAutoRenewed(sub.plan.title)).catch((err) =>
      log.error({ err, subscriptionId: sub.id }, 'failed to notify user of auto-renewal')
    )
    return true
  } catch (err) {
    log.warn({ err, subscriptionId: sub.id }, 'auto-renew failed, likely insufficient balance')
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: SubStatus.EXPIRED } })
    await sendTelegramMessage(sub.user.tgId, t(locale).subAutoRenewFailed(sub.plan.title)).catch((sendErr) =>
      log.error({ sendErr, subscriptionId: sub.id }, 'failed to notify user of auto-renew failure')
    )
    return false
  }
}

export function startSubsRemindWorker() {
  return createWorker<Record<string, never>, void>(QueueName.SubsRemind, processSubsRemind)
}
