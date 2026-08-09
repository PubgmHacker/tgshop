export const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'your_shop_bot';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? 'https://example.com';

export const ANALYTICS_PROVIDER = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? '';
export const ANALYTICS_DOMAIN = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN ?? '';
export const ANALYTICS_SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL ?? '';

export function botDeepLink(startParam = 'web'): string {
  return `https://t.me/${BOT_USERNAME}?start=${startParam}`;
}
