import type { Bot } from 'grammy'
import type { BotContext } from './context.js'
import { logger } from '../lib/logger.js'
import { env } from '../config/env.js'
import { versionedWebAppUrl } from './webAppUrls.js'

interface CommandSpec {
  command: string
  description: string
}

/** What regular users see behind Telegram's "/" button, per language. */
export const PUBLIC_COMMANDS: { en: CommandSpec[]; ru: CommandSpec[] } = {
  en: [{ command: 'start', description: 'Open the shop menu' }],
  ru: [{ command: 'start', description: 'Открыть меню магазина' }]
}

/**
 * The full list for admin chats. A chat-scoped list REPLACES the default one
 * entirely (it is not merged), so /start has to be repeated here.
 */
export const ADMIN_COMMANDS: CommandSpec[] = [
  { command: 'start', description: 'Open the shop menu' },
  { command: 'admin', description: 'Open the admin panel' },
  { command: 'stats', description: 'Users, orders and revenue totals' },
  { command: 'addstock', description: 'addstock <planId> <payload> — add a stock item' },
  { command: 'broadcast', description: 'broadcast <text> — message all users' },
  { command: 'user', description: 'user <tgId> — profile, balance, block state' },
  { command: 'refund', description: 'refund <orderId> — refund a paid order' },
  { command: 'grant', description: 'grant <userId> <USD> — credit a balance' }
]

/**
 * Publishes the command menus Telegram renders behind the "/" and ≡ buttons.
 *
 * Menus are cosmetic, so every failure is logged and swallowed rather than
 * failing the boot. The per-admin calls are expected to fail with
 * "Bad Request: chat not found" until that admin has started the bot once —
 * Telegram only lets a bot scope commands to chats it has seen.
 */
export async function registerBotCommands(
  bot: Bot<BotContext>,
  adminIds: readonly bigint[]
): Promise<void> {
  try {
    await bot.api.setMyCommands(PUBLIC_COMMANDS.en)
    await bot.api.setMyCommands(PUBLIC_COMMANDS.ru, { language_code: 'ru' })
  } catch (err) {
    logger.warn({ err }, 'failed to set public bot commands')
  }

  // The chat's ≡ menu button opens the Mini App with the release-stamped URL
  // (see webAppUrls.ts) so phones stop reviving cached bundles from previous
  // deploys. Reply keyboards sent earlier keep their old URL until the next
  // /start; the menu button is bot-level and updates for everyone at boot.
  try {
    const current = await bot.api.getChatMenuButton()
    const text = current.type === 'web_app' && current.text ? current.text : 'Магазин'
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text, web_app: { url: versionedWebAppUrl(env.MINIAPP_URL) } }
    })
  } catch (err) {
    logger.warn({ err }, 'failed to set chat menu button')
  }

  for (const adminId of adminIds) {
    try {
      await bot.api.setMyCommands(ADMIN_COMMANDS, {
        scope: { type: 'chat', chat_id: Number(adminId) }
      })
    } catch (err) {
      // bigint is not JSON-serializable, so the log field is its string form.
      logger.warn({ err, adminId: adminId.toString() }, 'failed to set admin bot commands')
    }
  }
}
