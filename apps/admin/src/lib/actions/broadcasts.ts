'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, PostSource, PostStatus, type Prisma } from '@tgshop/db'
import { countSegment, FEATURED_PRODUCT_SLUG, mirasimAnnouncement, mirasimProductLink } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { getBroadcastQueue, broadcastJobId, BROADCAST_JOB_NAME } from '../queue'
import { isBroadcastFrozen, isBroadcastSendable, isBroadcastCancellable } from '../broadcasts-policy'
import {
  broadcastSendSchema,
  broadcastUpsertSchema,
  BROADCAST_SEGMENTS,
  type BroadcastSegment,
  type BroadcastSendInput,
  type BroadcastUpsertInput
} from '../schemas'

export interface SegmentCount {
  segment: BroadcastSegment
  count: number
  workerSupported: boolean
}

export async function mirasimBroadcastTemplateAction(): Promise<{ text: string } | null> {
  await requireRole(AdminRole.ADMIN)
  const product = await prisma.product.findFirst({ where: { slug: FEATURED_PRODUCT_SLUG, isActive: true, category: { isActive: true } }, select: { id: true } })
  const miniappUrl = process.env.MINIAPP_URL ?? ''
  const username = process.env.BOT_USERNAME?.trim().replace(/^@/, '') ?? ''
  if (!product || (!miniappUrl && !/^[a-zA-Z0-9_]{5,32}$/.test(username))) return null
  return { text: mirasimAnnouncement(mirasimProductLink(miniappUrl, process.env.BOT_USERNAME)) }
}

/**
 * Recipient count per segment, so the compose form can show how many users a
 * broadcast would actually reach before it is queued. The filters come from
 * @tgshop/core's segmentWhere(), which is the same definition apps/worker uses
 * to pick recipients — so this preview cannot drift from the real send.
 */
export async function segmentCountsAction(): Promise<SegmentCount[]> {
  await requireRole(AdminRole.SUPPORT)

  return Promise.all(
    BROADCAST_SEGMENTS.map(async (definition) => ({
      segment: definition.value,
      workerSupported: definition.workerSupported,
      count: await countSegment(prisma, definition.value)
    }))
  )
}

export async function listBroadcastsAction() {
  await requireRole(AdminRole.SUPPORT)
  return prisma.broadcastPost.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function getBroadcastAction(id: string) {
  await requireRole(AdminRole.SUPPORT)
  return prisma.broadcastPost.findUnique({ where: { id } })
}

/**
 * Creates or updates a broadcast in an editable state.
 *
 * A QUEUED post is editable, but only after its queue job has been pulled —
 * otherwise the worker could pick up the delayed job seconds later and send the
 * text as it was mid-edit. Cancel first, then edit; the action does that itself
 * so the operator does not have to sequence two clicks correctly.
 */
export async function upsertBroadcastAction(input: BroadcastUpsertInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = broadcastUpsertSchema.parse(input)

  if (data.id) {
    const existing = await prisma.broadcastPost.findUnique({ where: { id: data.id } })
    if (existing && isBroadcastFrozen(existing.status)) {
      throw new Error(`Broadcast ${data.id} has already been sent/is sending and cannot be edited`)
    }
    if (existing && isBroadcastCancellable(existing.status)) {
      await removeQueuedJob(existing.id)
    }
  }

  const fields = {
    text: data.text,
    mediaUrl: data.mediaUrl ?? null,
    segment: data.segment ?? null,
    scheduledAt: data.scheduledAt ?? null,
    status: data.scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT,
    source: PostSource.MANUAL
  }

  const post = data.id
    ? await prisma.broadcastPost.update({ where: { id: data.id }, data: fields })
    : await prisma.broadcastPost.create({ data: fields })

  await writeAuditLog({
    actorId: session.adminId,
    action: data.id ? 'broadcast.update' : 'broadcast.create',
    entity: 'BroadcastPost',
    entityId: post.id,
    diff: data as unknown as Prisma.InputJsonValue
  })

  revalidatePath('/broadcasts')
  return post
}

/**
 * Hands a broadcast to the worker's BullMQ queue.
 *
 * Two things here are load-bearing:
 *
 *  • The post goes to QUEUED, not SENDING. A scheduled broadcast sits in the
 *    queue holding its delay — possibly for days — and during that time it has
 *    reached nobody and must stay cancellable. The worker flips it to SENDING
 *    when it actually starts fanning out. Writing SENDING here made every queued
 *    post permanently frozen, since both edit and delete refuse SENDING.
 *
 *  • The job carries a deterministic jobId. Without one BullMQ mints a random
 *    id, and a delayed job nobody can name is a delayed job nobody can pull
 *    back. It also makes the enqueue idempotent against the worker's scheduled
 *    sweep, so a post cannot be armed twice and go out twice.
 */
export async function sendBroadcastAction(input: BroadcastSendInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = broadcastSendSchema.parse(input)

  const post = await prisma.broadcastPost.findUnique({ where: { id: data.id } })
  if (!post) {
    throw new Error(`Broadcast not found: ${data.id}`)
  }
  if (!isBroadcastSendable(post.status)) {
    throw new Error(`Broadcast ${data.id} is already queued/sending/sent`)
  }

  const delayMs =
    post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? post.scheduledAt.getTime() - Date.now() : 0

  // The row moves first: if the enqueue then fails, a QUEUED post with no job is
  // recoverable (the worker's sweep re-arms scheduled posts, and the operator
  // can cancel and re-send), whereas a job pointing at a DRAFT row would be
  // delivered by a worker that has no idea an admin never armed it.
  const updated = await prisma.broadcastPost.update({
    where: { id: data.id },
    data: { status: PostStatus.QUEUED }
  })

  // A previous run of this post leaves its job in Redis under the same id
  // (removeOnComplete/removeOnFail keep a retention window), and BullMQ treats
  // add() with an existing id as a no-op. Without this, re-sending a FAILED or
  // CANCELLED broadcast would enqueue nothing at all and look like it worked.
  await removeQueuedJob(post.id)

  await getBroadcastQueue().add(
    BROADCAST_JOB_NAME,
    { postId: post.id },
    { jobId: broadcastJobId(post.id), delay: delayMs, removeOnComplete: 1000, removeOnFail: 1000 }
  )

  await writeAuditLog({
    actorId: session.adminId,
    action: 'broadcast.send',
    entity: 'BroadcastPost',
    entityId: data.id,
    diff: { delayMs }
  })

  revalidatePath('/broadcasts')
  return updated
}

/**
 * Pulls a queued broadcast back before it goes out.
 *
 * Only a QUEUED post can be cancelled — once the worker is fanning out, some
 * recipients already have the message and "cancelled" would be a lie. The row
 * is flipped only after the job is actually gone from Redis, so a failed
 * removal leaves the post visibly QUEUED rather than showing CANCELLED while
 * the send proceeds anyway.
 */
export async function cancelBroadcastAction(input: BroadcastSendInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = broadcastSendSchema.parse(input)

  const post = await prisma.broadcastPost.findUnique({ where: { id: data.id } })
  if (!post) {
    throw new Error(`Broadcast not found: ${data.id}`)
  }
  if (!isBroadcastCancellable(post.status)) {
    throw new Error(`Broadcast ${data.id} is not queued and cannot be cancelled (status ${post.status})`)
  }

  await removeQueuedJob(post.id)

  const updated = await prisma.broadcastPost.update({
    where: { id: data.id },
    data: { status: PostStatus.CANCELLED }
  })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'broadcast.cancel',
    entity: 'BroadcastPost',
    entityId: data.id
  })

  revalidatePath('/broadcasts')
  return updated
}

export async function deleteBroadcastAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  const post = await prisma.broadcastPost.findUnique({ where: { id } })
  if (post && isBroadcastFrozen(post.status)) {
    throw new Error(`Broadcast ${id} has already been sent/is sending and cannot be deleted`)
  }
  // Delete the queue job before the row: a job whose post no longer exists is
  // logged and dropped by the worker, but the reverse ordering would leave a
  // live job racing the delete.
  if (post && isBroadcastCancellable(post.status)) {
    await removeQueuedJob(id)
  }
  await prisma.broadcastPost.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'broadcast.delete', entity: 'BroadcastPost', entityId: id })
  revalidatePath('/broadcasts')
}

/**
 * Removes a post's pending queue job, if one is still there.
 *
 * A missing job is not an error: the worker may have picked it up microseconds
 * ago, or a previous cancel may have already removed it. What IS an error is a
 * job that exists but refuses to be removed — BullMQ's remove() throws when the
 * job is active, which is exactly the "too late, it is already sending" case
 * the caller must not paper over.
 */
async function removeQueuedJob(postId: string): Promise<void> {
  const job = await getBroadcastQueue().getJob(broadcastJobId(postId))
  if (!job) return
  await job.remove()
}
