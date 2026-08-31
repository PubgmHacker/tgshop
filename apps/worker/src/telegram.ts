import { Api } from 'grammy'
import { loadEnv } from './env.js'
import { logger } from './logger.js'
import { adminStrings } from './i18n.js'

// ─────────────────────────────────────────────────────────────────────────────
// Thin grammY Bot API client for outbound sends from the worker process.
// Deliberately does NOT import apps/bot — worker only needs to call the raw
// Telegram Bot API to push messages, not run the bot's update handlers.
// ─────────────────────────────────────────────────────────────────────────────

let api: Api | undefined

export function getTelegramApi(): Api {
  if (api) return api
  const env = loadEnv()
  api = new Api(env.BOT_TOKEN)
  return api
}

export interface InlineButton {
  text: string
  callbackData: string
}

export class TelegramBlockedError extends Error {
  constructor(public readonly chatId: string) {
    super(`User ${chatId} has blocked the bot`)
    this.name = 'TelegramBlockedError'
  }
}

export class TelegramRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Rate limited, retry after ${retryAfterSeconds}s`)
    this.name = 'TelegramRateLimitError'
  }
}

/**
 * Sends a text message to a Telegram chat. Classifies known error shapes into
 * typed errors so callers (broadcast queue, notify queue) can react correctly:
 * 403 -> TelegramBlockedError, 429 -> TelegramRateLimitError (with retry_after).
 */
export async function sendTelegramMessage(
  chatId: string | bigint,
  text: string,
  options?: { buttons?: InlineButton[][]; photoUrl?: string }
): Promise<void> {
  const telegramApi = getTelegramApi()
  try {
    const replyMarkup = options?.buttons
      ? {
          inline_keyboard: options.buttons.map((row) =>
            row.map((b) => ({ text: b.text, callback_data: b.callbackData }))
          )
        }
      : undefined

    if (options?.photoUrl) {
      // Telegram captions are limited to 1,024 characters. The full message is
      // still stored in BroadcastPost; the operator's media attachment gets a
      // readable caption instead of turning into a bare URL in every chat.
      await telegramApi.sendPhoto(chatId.toString(), options.photoUrl, {
        caption: text.length > 1_024 ? `${text.slice(0, 1_021)}…` : text,
        reply_markup: replyMarkup,
        parse_mode: undefined
      })
      return
    }

    await telegramApi.sendMessage(chatId.toString(), text, {
      reply_markup: replyMarkup,
      parse_mode: undefined
    })
  } catch (err) {
    const description = extractDescription(err)
    const retryAfter = extractRetryAfter(err)
    if (retryAfter !== null) {
      throw new TelegramRateLimitError(retryAfter)
    }
    if (isForbidden(err)) {
      throw new TelegramBlockedError(chatId.toString())
    }
    logger.error({ err, chatId: chatId.toString(), description }, 'sendTelegramMessage failed')
    throw err
  }
}

/** Sends a message to all configured admin chat ids, best-effort (logs failures, never throws). */
export async function notifyAdmins(text: string): Promise<void> {
  const env = loadEnv()
  for (const chatId of env.ADMIN_IDS) {
    try {
      await sendTelegramMessage(chatId, text)
    } catch (err) {
      logger.error({ err, chatId: chatId.toString() }, 'notifyAdmins: failed to notify admin chat')
    }
  }
}

export async function notifyLowStock(planTitle: string, remaining: number, threshold: number): Promise<void> {
  await notifyAdmins(adminStrings.lowStock(planTitle, remaining, threshold))
}

function extractDescription(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'description' in err) {
    return String((err as { description: unknown }).description)
  }
  return undefined
}

function isForbidden(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const errorCode = (err as { error_code?: unknown; errorCode?: unknown }).error_code ??
    (err as { errorCode?: unknown }).errorCode
  return errorCode === 403
}

function extractRetryAfter(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const errorCode = (err as { error_code?: unknown }).error_code
  if (errorCode !== 429) return null
  const parameters = (err as { parameters?: { retry_after?: unknown } }).parameters
  const retryAfter = parameters?.retry_after
  return typeof retryAfter === 'number' ? retryAfter : 1
}
