// Telegram's WebView caches Mini App documents aggressively, so after a
// release phones can keep running the previous bundle indefinitely. Keying
// every web_app URL by the deployed commit turns each release into a document
// URL the cache has never seen. Railway injects RAILWAY_GIT_COMMIT_SHA at
// runtime; anywhere it is absent (dev, tests) URLs pass through untouched.
const build = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7)

export function versionedWebAppUrl(url: string): string {
  if (!build) return url
  const parsed = new URL(url)
  parsed.searchParams.set('v', build)
  return parsed.toString()
}
