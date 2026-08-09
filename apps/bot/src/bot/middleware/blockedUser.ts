import type { NextFunction } from 'grammy'
import type { BotContext } from '../context.js'
import { prisma } from '@tgshop/db'
import { t } from '../../i18n/index.js'

/** Blocks any interaction from a user flagged isBlocked. */
export async function blockedUserGuard(ctx: BotContext, next: NextFunction): Promise<void> {
  const tgId = ctx.from?.id
  if (!tgId) {
    await next()
    return
  }
  const user = await prisma.user.findUnique({ where: { tgId: BigInt(tgId) } })
  if (user?.isBlocked) {
    await ctx.reply(t(ctx.session.locale, 'errors.blocked'))
    return
  }
  await next()
}
