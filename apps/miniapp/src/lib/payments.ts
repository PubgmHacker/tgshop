'use client'

import { invoice, openLink, openTelegramLink } from '@telegram-apps/sdk-react'

// ─────────────────────────────────────────────────────────────────────────────
// Opens a provider payment URL the right way for the current environment:
//   - Telegram invoice links (createInvoiceLink → https://t.me/$slug) open with
//     the native invoice sheet, so Stars payments never leave the Mini App;
//   - other t.me links (CryptoBot) open inside Telegram;
//   - anything else opens externally. Outside Telegram, falls back to the
//     browser so local development still works.
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_LINK = /^https:\/\/t\.me\/(\$|invoice\/)/

export function openPaymentUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return
  } catch { return }
  try {
    if (INVOICE_LINK.test(url) && invoice.open.isAvailable()) {
      void invoice.open(url, 'url')
      return
    }
    if (url.startsWith('https://t.me/') && openTelegramLink.isAvailable()) {
      openTelegramLink(url)
      return
    }
    if (openLink.isAvailable()) {
      openLink(url)
      return
    }
  } catch {
    // fall through to the plain browser navigation below
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
