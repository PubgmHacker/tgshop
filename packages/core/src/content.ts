import type { BroadcastPost, Prisma, PrismaClient } from '@tgshop/db'
import { PostSource, PostStatus, SubStatus, OrderStatus } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// BroadcastPost domain (Phase-2 groundwork for docs/AGENT_PLAN.md).
//
// Agent-authored posts land as DRAFT and stay there: a human approves before
// anything reaches a customer. Nothing here sends messages — that is the
// worker's job — so this module stays free of any Telegram dependency.
//
// NOTE ON NAMING: the status mutators are markPost* rather than mark*, because
// @tgshop/core re-exports every module from one barrel and orders.ts already
// owns markFailed.
// ─────────────────────────────────────────────────────────────────────────────

export type Segment = 'all' | 'buyers' | 'inactive_30d' | 'active_subscribers' | 'no_purchases'

export const SEGMENTS: readonly Segment[] = [
  'all',
  'buyers',
  'inactive_30d',
  'active_subscribers',
  'no_purchases'
] as const

/**
 * Narrows a segment string read from the database (BroadcastPost.segment is a
 * free-form nullable column) to the closed union. NULL means "all"; anything
 * unrecognized returns null so callers can refuse to send rather than default
 * to everyone — a typo in a segment name must never spam the whole user base.
 */
export function parseSegment(value: string | null | undefined): Segment | null {
  if (value === null || value === undefined || value === '') return 'all'
  return (SEGMENTS as readonly string[]).includes(value) ? (value as Segment) : null
}

export interface CreatePostInput {
  text: string
  channelId?: string
  segment?: Segment
  mediaUrl?: string
  scheduledAt?: Date
  source?: PostSource
}

export interface PostStats {
  total: number
  sent: number
  blocked: number
  failed: number
}

const INACTIVE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RATE_PER_SEC = 25

/** Creates a post. DRAFT unless a scheduledAt is supplied, and never SENDING. */
export async function createPost(
  prisma: PrismaClient,
  input: CreatePostInput
): Promise<BroadcastPost> {
  if (input.text.trim() === '') {
    throw new RangeError('createPost requires non-empty text')
  }

  return prisma.broadcastPost.create({
    data: {
      text: input.text,
      channelId: input.channelId ?? null,
      segment: input.segment ?? null,
      mediaUrl: input.mediaUrl ?? null,
      scheduledAt: input.scheduledAt ?? null,
      status: input.scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT,
      source: input.source ?? PostSource.MANUAL
    }
  })
}

export async function schedulePost(
  prisma: PrismaClient,
  id: string,
  at: Date
): Promise<BroadcastPost> {
  return prisma.broadcastPost.update({
    where: { id },
    data: { scheduledAt: at, status: PostStatus.SCHEDULED }
  })
}

export async function markPostSending(prisma: PrismaClient, id: string): Promise<BroadcastPost> {
  return prisma.broadcastPost.update({
    where: { id },
    data: { status: PostStatus.SENDING }
  })
}

export async function markPostSent(
  prisma: PrismaClient,
  id: string,
  stats?: PostStats,
  at: Date = new Date()
): Promise<BroadcastPost> {
  return prisma.broadcastPost.update({
    where: { id },
    data: {
      status: PostStatus.SENT,
      sentAt: at,
      ...(stats ? { statsJson: stats as unknown as Prisma.InputJsonValue } : {})
    }
  })
}

export async function markPostFailed(
  prisma: PrismaClient,
  id: string,
  reason: string
): Promise<BroadcastPost> {
  return prisma.broadcastPost.update({
    where: { id },
    data: {
      status: PostStatus.FAILED,
      statsJson: { error: reason } as unknown as Prisma.InputJsonValue
    }
  })
}

/**
 * The Prisma filter defining a segment's membership. Exported so that anything
 * previewing a recipient count (the admin compose form) and the worker that
 * actually sends both derive from ONE definition — a duplicated filter drifts,
 * and then the admin promises "1 240 recipients" while the worker mails 300.
 *
 * The switch is exhaustive on purpose: adding a Segment member without a case
 * here is a compile error rather than a silent send-to-all.
 */
export function segmentWhere(segment: Segment, now: Date = new Date()): Prisma.UserWhereInput {
  switch (segment) {
    case 'buyers':
      // "Bought something" means money actually moved — a PENDING or FAILED
      // order is not a purchase.
      return {
        isBlocked: false,
        orders: {
          some: {
            status: { in: [OrderStatus.PAID, OrderStatus.DELIVERING, OrderStatus.DELIVERED] }
          }
        }
      }
    case 'inactive_30d':
      return {
        isBlocked: false,
        orders: { none: { createdAt: { gte: new Date(now.getTime() - INACTIVE_DAYS * DAY_MS) } } }
      }
    case 'active_subscribers':
      // Status alone is not enough: a subscription can still be ACTIVE in the
      // row while already past expiresAt if the expiry sweep has not run yet.
      return {
        isBlocked: false,
        subscriptions: { some: { status: SubStatus.ACTIVE, expiresAt: { gt: now } } }
      }
    case 'no_purchases':
      return { isBlocked: false, orders: { none: {} } }
    case 'all':
      return { isBlocked: false }
  }
}

/** Number of users a segment would reach. Shares segmentWhere() with the sender. */
export async function countSegment(
  prisma: PrismaClient,
  segment: Segment,
  now: Date = new Date()
): Promise<number> {
  return prisma.user.count({ where: segmentWhere(segment, now) })
}

/** A broadcast recipient: `tgId` to send to, `id` to flag the user if they blocked the bot. */
export interface SegmentRecipient {
  id: string
  tgId: bigint
}

/**
 * Recipients of a segment. Blocked users are excluded from every segment — an
 * unknown segment string cannot reach this function, because Segment is a
 * closed union, so there is no "silently broadcast to everyone" path.
 */
export async function resolveSegmentRecipients(
  prisma: PrismaClient,
  segment: Segment,
  now: Date = new Date()
): Promise<SegmentRecipient[]> {
  const where = segmentWhere(segment, now)

  return prisma.user.findMany({ where, select: { id: true, tgId: true } })
}

/** Telegram ids of a segment's recipients. Thin wrapper over resolveSegmentRecipients(). */
export async function resolveSegment(
  prisma: PrismaClient,
  segment: Segment,
  now: Date = new Date()
): Promise<bigint[]> {
  const recipients = await resolveSegmentRecipients(prisma, segment, now)
  return recipients.map((user) => user.tgId)
}

/**
 * Splits recipients into one batch per second of send budget. The caller sends a
 * batch, waits a second, sends the next — which keeps the shop under Telegram's
 * ~30 messages/second ceiling without tracking timestamps per message.
 */
export function chunkForRateLimit<T>(items: T[], perSecond: number = DEFAULT_RATE_PER_SEC): T[][] {
  if (!Number.isInteger(perSecond) || perSecond < 1) {
    throw new RangeError(`chunkForRateLimit expects a positive integer perSecond, got ${perSecond}`)
  }

  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += perSecond) {
    chunks.push(items.slice(i, i + perSecond))
  }
  return chunks
}
