import type { Context, SessionFlavor } from 'grammy'
import type { ConversationFlavor } from '@grammyjs/conversations'
import type { Locale } from '../i18n/index.js'

export interface SessionData {
  locale: Locale
  pendingPromoCode?: string
  /**
   * A checkout waiting on the buyer's email (requiresEmail products): the pay
   * button parks its parameters here and the message:text handler resumes the
   * purchase once a valid address arrives. Cleared on resume, on any menu
   * button and on any command, so a stale prompt can never swallow messages.
   */
  checkout?: {
    planId: string
    qty: number
    provider: 'BALANCE' | 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'
    awaitingEmail: boolean
  }
}

// @grammyjs/conversations v2 turned ConversationFlavor into a wrapper
// (ConversationFlavor<C> = C & { conversation }), so the outer context has to be
// passed in rather than intersected alongside.
export type BotContext = ConversationFlavor<Context & SessionFlavor<SessionData>>

export function initialSession(): SessionData {
  return { locale: 'en' }
}
