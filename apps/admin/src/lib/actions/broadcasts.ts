'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, PostSource, PostStatus, type Prisma } from '@tgshop/db'
import { countSegment } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { getBroadcastQueue, BROADCAST_JOB_NAME } from '../queue'
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

/**
 * Recipient count per segment, so the compose form can show how many users a
 * broadcast would actually reach before it is queued. The filters come from
 * @tgshop/core's segmentWhere(), which is the same definition apps/worker uses
 * to pick recipients — so this preview cannot drift from the real send.
 */
export async function segmentCountsAction(): Promise<SegmentCount[]> {
  requireRole(AdminRole.SUPPORT)

  return Promise.all(
    BROADCAST_SEGMENTS.map(async (definition) => ({
      segment: definition.value,
      workerSupported: definition.workerSupported,
      count: await countSegment(prisma, definition.value)
    }))
  )
}

export async function listBroadcastsAction() {
  requireRole(AdminRole.SUPPORT)
  return prisma.broadcastPost.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function getBroadcastAction(id: string) {
  requireRole(AdminRole.SUPPORT)
  return prisma.broadcastPost.findUnique({ where: { id } })
}

/** Creates or updates a broadcast in DRAFT/SCHEDULED state. Never touches SENT/SENDING posts. */
export async function upsertBroadcastAction(input: BroadcastUpsertInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = broadcastUpsertSchema.parse(input)

  if (data.id) {
    const existing = await prisma.broadcastPost.findUnique({ where: { id: data.id } })
    if (existing && (existing.status === PostStatus.SENDING || existing.status === PostStatus.SENT)) {
      throw new Error(`Broadcast ${data.id} has already been sent/is sending and cannot be edited`)
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
 * Enqueues a broadcast for delivery via the worker's BullMQ queue. Marks the
 * post SENDING immediately so it can't be double-enqueued; the worker is
 * responsible for flipping it to SENT/FAILED and populating statsJson.
 */
export async function sendBroadcastAction(input: BroadcastSendInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = broadcastSendSchema.parse(input)

  const post = await prisma.broadcastPost.findUnique({ where: { id: data.id } })
  if (!post) {
    throw new Error(`Broadcast not found: ${data.id}`)
  }
  if (post.status === PostStatus.SENDING || post.status === PostStatus.SENT) {
    throw new Error(`Broadcast ${data.id} is already sending/sent`)
  }

  const updated = await prisma.broadcastPost.update({
    where: { id: data.id },
    data: { status: PostStatus.SENDING }
  })

  const delayMs =
    post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? post.scheduledAt.getTime() - Date.now() : 0

  await getBroadcastQueue().add(
    BROADCAST_JOB_NAME,
    { postId: post.id },
    { delay: delayMs, removeOnComplete: 1000, removeOnFail: 1000 }
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

export async function deleteBroadcastAction(id: string) {
  const session = requireRole(AdminRole.OWNER)
  const post = await prisma.broadcastPost.findUnique({ where: { id } })
  if (post && (post.status === PostStatus.SENDING || post.status === PostStatus.SENT)) {
    throw new Error(`Broadcast ${id} has already been sent/is sending and cannot be deleted`)
  }
  await prisma.broadcastPost.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'broadcast.delete', entity: 'BroadcastPost', entityId: id })
  revalidatePath('/broadcasts')
}
