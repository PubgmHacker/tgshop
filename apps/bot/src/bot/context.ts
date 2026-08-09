import type { Context, SessionFlavor } from 'grammy'
import type { ConversationFlavor } from '@grammyjs/conversations'
import type { Locale } from '../i18n/index.js'

export interface SessionData {
  locale: Locale
  pendingPromoCode?: string
  checkout?: {
    planId: string
    qty: number
  }
}

// @grammyjs/conversations v2 turned ConversationFlavor into a wrapper
// (ConversationFlavor<C> = C & { conversation }), so the outer context has to be
// passed in rather than intersected alongside.
export type BotContext = ConversationFlavor<Context & SessionFlavor<SessionData>>

export function initialSession(): SessionData {
  return { locale: 'en' }
}
