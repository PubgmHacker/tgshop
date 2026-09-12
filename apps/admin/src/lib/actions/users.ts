'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, type Prisma } from '@tgshop/db'
import { credit, debit } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import {
  balanceAdjustSchema,
  userBanSchema,
  userSearchSchema,
  type BalanceAdjustInput,
  type UserBanInput,
  type UserSearchInput
} from '../schemas'

export async function searchUsersAction(input: UserSearchInput) {
  await requireRole(AdminRole.SUPPORT)
  const data = userSearchSchema.parse(input)

  const query = data.query.trim()
  const where: Prisma.UserWhereInput = query
    ? {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { id: query },
          ...(isNumeric(query) ? [{ tgId: BigInt(query) }] : [])
        ]
      }
    : {}

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (data.page - 1) * data.pageSize,
      take: data.pageSize
    }),
    prisma.user.count({ where })
  ])

  return { users, total, page: data.page, pageSize: data.pageSize }
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value)
}

export async function getUserDetailAction(userId: string) {
  await requireRole(AdminRole.SUPPORT)
  const [user, orders, balanceCents] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plan: { include: { product: { select: { id: true, title: true, deliveryType: true } } } } },
      take: 100
    }),
    prisma.balanceTransaction.aggregate({ where: { userId }, _sum: { amountCents: true } })
  ])

  return {
    user,
    orders,
    balanceCents: balanceCents._sum.amountCents ?? 0
  }
}

/** Append-only ledger history for one user, newest first. Read-only, so SUPPORT may see it. */
export async function listUserLedgerAction(userId: string, take = 200) {
  await requireRole(AdminRole.SUPPORT)
  return prisma.balanceTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take
  })
}

/** Adjusts a user's balance via the append-only ledger — never a direct write to a balance column. */
export async function adjustBalanceAction(input: BalanceAdjustInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = balanceAdjustSchema.parse(input)

  const idempotencyKey = `admin-adjust:${session.adminId}:${data.userId}:${Date.now()}:${data.amountCents}`

  const result = await prisma.$transaction(async (tx) => {
    if (data.amountCents > 0) {
      return credit(tx, {
        userId: data.userId,
        amountCents: data.amountCents,
        type: data.type,
        comment: data.comment,
        idempotencyKey
      })
    }
    return debit(tx, {
      userId: data.userId,
      amountCents: Math.abs(data.amountCents),
      type: data.type,
      comment: data.comment,
      idempotencyKey
    })
  })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'user.balanceAdjust',
    entity: 'User',
    entityId: data.userId,
    diff: { amountCents: data.amountCents, comment: data.comment, balanceAfterCents: result.balanceAfterCents }
  })

  revalidatePath(`/users/${data.userId}`)
  return result
}

export async function setUserBanAction(input: UserBanInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = userBanSchema.parse(input)

  const user = await prisma.user.update({ where: { id: data.userId }, data: { isBlocked: data.isBlocked } })

  await writeAuditLog({
    actorId: session.adminId,
    action: data.isBlocked ? 'user.ban' : 'user.unban',
    entity: 'User',
    entityId: data.userId
  })

  revalidatePath(`/users/${data.userId}`)
  revalidatePath('/users')
  return user
}
