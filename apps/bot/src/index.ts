import { prisma } from '@tgshop/db'
import type { FastifyInstance } from 'fastify'
import type { Bot } from 'grammy'
import { env } from './config/env.js'
import { redis } from './config/redis.js'
import { createBot } from './bot/index.js'
import { registerBotCommands } from './bot/commands.js'
import type { BotContext } from './bot/context.js'
import { buildServer } from './server/app.js'
import { closeBroadcastQueue } from './domain/content.js'
import { closeReconcileQueues } from './domain/reconcile.js'
import { logger } from './lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// @tgshop/bot process entrypoint.
//
// One process serves three surfaces (docs/ARCHITECTURE.md): the grammY bot, the
// Mini App REST API, and the /internal/* service API.
//
// Update transport:
//   WEBHOOK_URL set   -> webhook mode. Telegram POSTs to
//                        <WEBHOOK_URL>/webhook/telegram/<WEBHOOK_SECRET>, and
//                        the route rejects any other secret in constant time.
//   WEBHOOK_URL unset -> long polling (the default for local dev, where
//                        Telegram cannot reach localhost).
// ─────────────────────────────────────────────────────────────────────────────

/** Milliseconds to let in-flight work finish before forcing exit. */
const SHUTDOWN_GRACE_MS = 15_000

interface Runtime {
  app: FastifyInstance
  bot: Bot<BotContext>
  usingWebhook: boolean
}

async function startBotTransport(bot: Bot<BotContext>): Promise<boolean> {
  if (env.WEBHOOK_URL) {
    const webhookUrl = `${env.WEBHOOK_URL.replace(/\/+$/, '')}/webhook/telegram/${env.WEBHOOK_SECRET}`

    // grammY needs the bot initialized before api calls when not using start().
    await bot.init()
    await bot.api.setWebhook(webhookUrl, {
      secret_token: env.WEBHOOK_SECRET,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'my_chat_member']
    })

    logger.info({ mode: 'webhook', username: bot.botInfo.username }, 'Telegram updates via webhook')
    return true
  }

  // Long polling: clear any webhook a previous deploy registered, otherwise
  // Telegram refuses getUpdates with a 409.
  await bot.init()
  await bot.api.deleteWebhook({ drop_pending_updates: false })

  // bot.start() only resolves when polling stops, so it must not be awaited here.
  void bot.start({
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'my_chat_member'],
    onStart: (info) => logger.info({ mode: 'long-polling', username: info.username }, 'Telegram updates via long polling')
  })

  return false
}

async function main(): Promise<void> {
  // env is validated at import time and exits(1) with a readable report on
  // failure, so reaching this line means configuration is sound.
  logger.info({ nodeEnv: env.NODE_ENV, port: env.PORT }, 'starting @tgshop/bot')

  const bot = createBot()
  const app = await buildServer(bot)

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  logger.info({ port: env.PORT }, 'HTTP server listening')

  const usingWebhook = await startBotTransport(bot)

  // Telegram renders these behind the "/" and ≡ buttons; without them users
  // see an empty command menu. Failures are logged inside, never fatal.
  await registerBotCommands(bot, env.ADMIN_IDS)

  installShutdownHandlers({ app, bot, usingWebhook })
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown: stop accepting new work, drain in-flight requests, then
// close every external connection. Idempotent — a second signal is ignored
// rather than tearing down a half-finished drain.
// ─────────────────────────────────────────────────────────────────────────────

let shuttingDown = false

function installShutdownHandlers(runtime: Runtime): void {
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'shutdown already in progress, ignoring signal')
      return
    }
    shuttingDown = true
    void gracefulShutdown(runtime, signal)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection')
  })

  process.on('uncaughtException', (err) => {
    // An uncaught exception leaves the process in an undefined state: log it,
    // then let the supervisor restart us rather than limping on.
    logger.fatal({ err }, 'uncaughtException — shutting down')
    if (!shuttingDown) {
      shuttingDown = true
      void gracefulShutdown(runtime, 'uncaughtException', 1)
    }
  })
}

async function gracefulShutdown(runtime: Runtime, signal: string, exitCode = 0): Promise<void> {
  logger.info({ signal }, 'graceful shutdown started')

  const forceTimer = setTimeout(() => {
    logger.fatal({ signal, graceMs: SHUTDOWN_GRACE_MS }, 'shutdown timed out, forcing exit')
    process.exit(1)
  }, SHUTDOWN_GRACE_MS)
  // Do not let the timer itself hold the event loop open.
  forceTimer.unref()

  try {
    // 1. Stop pulling in new Telegram updates.
    if (runtime.usingWebhook) {
      // Leave the webhook registered: deleting it would drop updates for the
      // whole restart window. Telegram retries what we fail to answer.
      logger.debug('webhook mode: leaving webhook registered across restart')
    } else {
      await runtime.bot.stop()
      logger.debug('bot polling stopped')
    }

    // 2. Stop accepting connections and let in-flight requests finish.
    await runtime.app.close()
    logger.debug('HTTP server closed')

    // 3. Close outbound connections, worst-case independently of each other.
    await closeBroadcastQueue()
    await closeReconcileQueues()

    const results = await Promise.allSettled([prisma.$disconnect(), redis.quit()])
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason }, 'error while closing a connection')
      }
    }

    clearTimeout(forceTimer)
    logger.info({ signal }, 'graceful shutdown complete')
    process.exit(exitCode)
  } catch (err) {
    clearTimeout(forceTimer)
    logger.error({ err, signal }, 'error during graceful shutdown')
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'fatal error during startup')
  process.exit(1)
})
