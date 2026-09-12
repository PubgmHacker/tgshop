/** Keep operator contacts intact; the legacy seed address is not a real shop contact. */
export function resolveSupportUrl(configured: string, landingUrl: string): string {
  if (configured === 'https://t.me/tgshop_support') return new URL('#faq', landingUrl).toString()
  return configured
}
