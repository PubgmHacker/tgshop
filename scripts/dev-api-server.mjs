// Local Mini App API without Telegram long-polling / webhook.
// Usage (from repo root, with .env loaded):
//   MINIAPP_URL=http://localhost:3100 PORT=3000 node scripts/dev-api-server.mjs
import { buildServer } from '../apps/bot/dist/server/app.js'
import { createBot } from '../apps/bot/dist/bot/index.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

const bot = createBot()
const app = await buildServer(bot)

await app.listen({ port, host })
console.log(`dev-api-server listening on http://${host}:${port} (no Telegram transport)`)

const shutdown = async (signal) => {
  console.log(`shutting down (${signal})`)
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
