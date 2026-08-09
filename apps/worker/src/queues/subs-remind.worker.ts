import type { Job } from 'bullmq'
import { prisma, SubStatus } from '@tgshop/db'
import { renewFromBalance, type RenewFailureReason } from '@tgshop/core'
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
//   - already expired: mark EXPIRED; if autoRenew is on, attempt to renew from
//     balance; otherwise leave expired (user must renew manually).
// remindedAt tracks only the most recent reminder sent, to avoid duplicate
// sends within the same day when the sweep runs more than once daily.
//
// The renewal itself is core's renewFromBalance(). This worker used to carry a
// second copy of it, and the copy debited under a DIFFERENT idempotency key
// (`sub-autorenew:` vs core's `sub-renew:`). Ledger idempotency is keyed on an
// opaque string, so those two keys did not deduplicate against each other: a
// user who tapped "Renew" while this sweep was auto-renewing the same period
// would have been charged twice for it. One implementation, one key.
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

/**
 * Ends a subscription period: renews it from balance when the user asked for
 * that, otherwise marks it EXPIRED. Returns true only when a renewal committed.
 *
 * core's renewFromBalance() closes the old period out itself as part of the
 * renewal transaction, so EXPIRED is written here only on the paths where no
 * renewal happened.
 */
async function tryExpireOrRenew(
  sub: Awaited<ReturnType<typeof prisma.subscription.findMany>>[number] & {
    user: { languageCode: string | null; tgId: bigint }
    plan: { title: string }
  },
  log: ReturnType<typeof jobLogger>
): Promise<boolean> {
  const env = loadEnv()
  const locale = resolveLocale(sub.user.languageCode)

  if (!sub.autoRenew || !env.SUBS_AUTO_RENEW_ENABLED) {
    await expire(sub.id)
    return false
  }

  let result
  try {
    result = await renewFromBalance(prisma, sub.id)
  } catch (err) {
    // Anything left is infrastructural (the ledger already answers a flat
    // balance with a typed refusal rather than a throw), so the period still
    // has to be closed — a subscription cannot stay ACTIVE past its expiry.
    log.error({ err, subscriptionId: sub.id }, 'auto-renew errored')
    await expire(sub.id)
    await notifyRenewFailed(sub, locale, log)
    return false
  }

  if (result.ok) {
    log.info({ subscriptionId: sub.id, orderId: result.orderId }, 'subscription auto-renewed')
    await sendTelegramMessage(sub.user.tgId, t(locale).subAutoRenewed(sub.plan.title)).catch((err) =>
      log.error({ err, subscriptionId: sub.id }, 'failed to notify user of auto-renewal')
    )
    return true
  }

  log.warn({ subscriptionId: sub.id, reason: result.reason }, 'auto-renew declined')
  await expire(sub.id)
  // 'not_active' means something else already closed this period out, so the
  // user has nothing to act on and does not need a message about it.
  if (result.reason !== 'not_active') {
    await notifyRenewFailed(sub, locale, log, result.reason)
  }
  return false
}

async function expire(subscriptionId: string): Promise<void> {
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: SubStatus.EXPIRED }
  })
}

async function notifyRenewFailed(
  sub: { id: string; user: { tgId: bigint }; plan: { title: string } },
  locale: 'ru' | 'en',
  log: ReturnType<typeof jobLogger>,
  reason?: RenewFailureReason
): Promise<void> {
  const strings = t(locale)
  const text =
    reason === 'plan_inactive'
      ? strings.subRenewPlanInactive(sub.plan.title)
      : strings.subAutoRenewFailed(sub.plan.title)
  await sendTelegramMessage(sub.user.tgId, text).catch((sendErr) =>
    log.error({ sendErr, subscriptionId: sub.id }, 'failed to notify user of auto-renew failure')
  )
}

export function startSubsRemindWorker() {
  return createWorker<Record<string, never>, void>(QueueName.SubsRemind, processSubsRemind)
}
