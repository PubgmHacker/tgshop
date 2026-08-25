import { Bot, session } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'
import { RedisAdapter } from '@grammyjs/storage-redis'
import type { BotContext } from './context.js'
import { initialSession, sessionKey } from './context.js'
import { redis } from '../config/redis.js'
import { env } from '../config/env.js'
import { errorBoundary, registerErrorHandler } from './middleware/errorHandler.js'
import { localeMiddleware } from './middleware/locale.js'
import { blockedUserGuard } from './middleware/blockedUser.js'
import { antiDoubleClick } from './middleware/antiDoubleClick.js'
import { rateLimit } from './middleware/rateLimit.js'
import { registerStartHandler } from './handlers/start.js'
import { registerCatalogHandlers } from './handlers/catalog.js'
import { registerCheckoutHandlers } from './handlers/checkout.js'
import { registerProfileHandlers } from './handlers/profile.js'
import { registerTopupHandlers, topupConversation } from './handlers/topup.js'
import { registerAdminHandlers } from './handlers/admin.js'

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN)

  // First in the chain: in webhook mode grammY does not route errors to
  // bot.catch, so without this boundary any thrown error becomes an HTTP 500
  // and Telegram retries the poisoned update forever, stalling all chats.
  bot.use(errorBoundary)

  const storage = new RedisAdapter({ instance: redis })
  bot.use(session({ initial: initialSession, storage, getSessionKey: sessionKey }))
  bot.use(conversations())
  bot.use(createConversation(topupConversation, 'topup'))

  bot.use(localeMiddleware)
  bot.use(blockedUserGuard)
  bot.use(rateLimit())
  bot.use(antiDoubleClick())

  registerStartHandler(bot)
  registerCatalogHandlers(bot)
  registerCheckoutHandlers(bot)
  registerProfileHandlers(bot)
  registerTopupHandlers(bot)
  registerAdminHandlers(bot)

  registerErrorHandler(bot)

  return bot
}
