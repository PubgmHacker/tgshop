# tgshop

A Telegram digital-goods store: bot + Mini App + admin panel + marketing
landing, backed by Postgres/Prisma, Redis/BullMQ, and support for balance,
CryptoBot, Telegram Stars, and USDT-TRC20 payments.

## Monorepo layout

```
apps/
  bot/        grammY Telegram bot (Fastify webhook server, Mini App API, /internal/*)
  worker/     BullMQ workers: payment reconciliation, delivery, TRON polling, broadcasts
  miniapp/    Next.js 15 App Router — Telegram Mini App storefront
  landing/    Next.js 15 App Router — public marketing site
  admin/      Next.js 15 App Router — internal admin panel
  admin-miniapp/ Next.js 15 App Router — Telegram admin interface
packages/
  db/         Prisma schema, migrations, seed, generated client (@tgshop/db)
  core/       Domain logic: money, pricing, crypto (payload encryption), ledger, errors (@tgshop/core)
  ui/         Design tokens, Tailwind preset, shared React components (@tgshop/ui)
docs/         This documentation
scripts/      Ops scripts (backup, restore, webhook setup, key generation)
bruno/        API collection + payment webhook simulators for local testing
```

See `docs/ARCHITECTURE.md` for the system diagram, `docs/PAYMENTS.md` for
per-provider payment flows and failure modes, `docs/DEPLOY.md` for a full VPS
deploy walkthrough, `docs/ADMIN.md` for the admin panel, and
`docs/AGENT_PLAN.md` for how an LLM agent plugs into `/internal/*` and the
Redis Streams event bus.

## 10-minute local setup

### 1. Prerequisites

- Node 20, pnpm 9 (`corepack enable` gives you the right pnpm automatically)
- Docker + Docker Compose (for Postgres/Redis, or run the whole stack)
- A Telegram account, and access to [@BotFather](https://t.me/BotFather)

### 2. Create your bot with @BotFather

1. Message `@BotFather` → `/newbot` → choose a name and a `_bot`-suffixed
   username. Save the **bot token** it gives you.
2. `/mybots` → your bot → **Bot Settings** → **Menu Button** → set it to open
   your Mini App URL once you have one (see step 6).
3. `/mybots` → your bot → **Payments** → this is where Telegram Stars support
   lives; Stars require no separate provider token, just enabling the bot for
   payments and using `currency: "XTR"` in `sendInvoice` (already wired in
   the bot's Stars flow, `apps/bot/src/payments/stars.ts`).

### 3. Clone, install, configure env

```bash
git clone <your-fork-url> tgshop && cd tgshop
corepack enable
pnpm install
cp .env.example .env
./scripts/gen-keys.sh >> .env   # fills ENCRYPTION_KEY / JWT_SECRET / WEBHOOK_SECRET / SERVICE_TOKEN
```

Open `.env` and fill in:

- `BOT_TOKEN` — from @BotFather above
- `BOT_USERNAME` — your bot's `@username`, without the `@`
- `ADMIN_IDS` — your numeric Telegram user ID(s), comma-separated (get yours
  from [@userinfobot](https://t.me/userinfobot)). The bot and the worker both
  read this one variable.
- `DATABASE_URL` / `REDIS_URL` — defaults match `docker-compose.dev.yml`, no
  change needed if you use it

`./scripts/gen-keys.sh` fills the five secrets (`ENCRYPTION_KEY`,
`JWT_SECRET`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `SERVICE_TOKEN`).
`SESSION_SECRET` must be at least 32 characters — the admin panel refuses to
boot otherwise. Never regenerate `ENCRYPTION_KEY` on a live deployment: every
`StockItem.payloadEnc` and `Order.deliveredPayloadEnc` encrypted under the old
key becomes permanently unreadable.

### 4. Start Postgres + Redis (and everything else, if you like)

The production `docker-compose.yml` keeps Postgres and Redis on the internal
network with no published ports. For local work, layer on the dev override,
which publishes them on **5433** and **6380** so they cannot collide with a
Postgres/Redis you already run on the default ports:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
pnpm db:migrate    # or: pnpm db:push  for a throwaway local schema
pnpm db:seed
```

Set `DATABASE_URL=postgresql://tgshop:tgshop@localhost:5433/tgshop?schema=public`
and `REDIS_URL=redis://localhost:6380` to match that override.

Prefer native services over Docker? Homebrew works just as well — point
`DATABASE_URL`/`REDIS_URL` at `localhost:5432` / `localhost:6379` and create
the role and database once:

```bash
brew services start postgresql@16 redis
createdb tgshop && psql -d postgres -c "CREATE ROLE tgshop LOGIN PASSWORD 'tgshop' CREATEDB"
```

Or run the entire stack, including the apps themselves:

```bash
docker compose up -d
```

### 5. Get a CryptoBot token (optional but recommended)

1. Message [@CryptoBot](https://t.me/CryptoBot) → **Crypto Pay** → **Create
   App** → name it after your shop.
2. Copy the **API Token** into `CRYPTOBOT_API_TOKEN`.
3. In the Crypto Pay app settings, set your **webhook URL** to
   `https://api.<your-domain>/webhook/cryptobot`. There is no separate webhook
   secret: CryptoBot signs each request with HMAC-SHA256 keyed by
   `SHA256(CRYPTOBOT_API_TOKEN)`, so the API token alone is enough. See
   `docs/PAYMENTS.md` for the exact signature verification scheme, and
   `bruno/tgshop/webhook-simulators` to test this locally without a public URL.
4. Leave `CRYPTOBOT_NETWORK=testnet` until you're ready to accept real funds.

### 6. Enable Telegram Stars

Stars need no separate signup — any bot can accept Stars payments once
Telegram enables payments for your bot (usually automatic; if `sendInvoice`
with `currency: "XTR"` is rejected, message `@BotSupport` and ask them to
enable Stars for your bot ID). Set `STARS_USD_RATE` in `.env` to a current
approximate USD/Star rate — it is **display/reporting only**; the actual
Stars amount charged is always the integer computed via
`usdCentsToStars()` in `@tgshop/core`, never a float.

### 7. Configure TRON / USDT-TRC20 (optional)

1. Put your own USDT-TRC20 receive address (for example the TRC-20 address of
   your Trust Wallet) into `TRON_RECEIVE_ADDRESS` on **both** the `bot` and
   the `worker` service. The legacy name `TRON_SWEEP_TO_ADDRESS` is accepted
   too. That is the only wallet-side setting: the shop holds no keys, derives
   no addresses and never signs a transaction — customers pay straight into
   your wallet and the worker only *reads* it.
2. Get a free API key at [TronGrid](https://www.trongrid.io/) →
   `TRONGRID_API_KEY` (worker). Anonymous access is rate-limited hard.
3. Leave `TRON_USDT_CONTRACT` at the mainnet USDT contract; `TRON_NETWORK` is
   informational (buyers pay from real wallets, so mainnet). There is no
   confirmation depth to tune: the worker asks TronGrid for solidified
   transfers only, and a solidified TRON block is final.
4. Every buyer is shown an exact amount with a unique sub-cent tag
   (`29.0057 USDT`) and must send it to the last decimal — the tag is how the
   worker tells invoices apart on one shared address. A rounded transfer is
   not lost: it surfaces as a `tron_unmatched` admin alert plus an `AuditLog`
   anomaly, to be credited by hand. Details in `docs/PAYMENTS.md`.

### 8. Register the Telegram webhook

```bash
./scripts/setup-webhook.sh set
./scripts/setup-webhook.sh info   # verify it stuck
```

Requires `WEBHOOK_URL` (a public HTTPS URL reachable by Telegram — see
`docs/DEPLOY.md` for exposing this via Caddy on a VPS, or use a tunnel like
`ngrok`/`cloudflared` for local development) and `WEBHOOK_SECRET` (already
generated in step 3) to be set in `.env`.

### 9. Run it

```bash
pnpm dev   # turbo run dev — bot, worker, miniapp, landing, admin all in watch mode
```

Open the Mini App by messaging your bot and tapping its menu button (or the
`/start` deep link), or open `http://localhost:3100` directly during
frontend-only development.

---

## How to add a new product

The catalog migration inserts **Mirasim**
(`packages/db/prisma/migrations/20260829060000_add_mirasim_catalog`): category
`code`, `deliveryType = MANUAL_FALLBACK` (an operator issues access by hand), one
plan `mirasim-pro-1m`. The migration only inserts (`ON CONFLICT DO NOTHING`), so
edit its price and description in the admin Mini App, not in SQL. Its official
marks are bundled: `apps/miniapp/public/brands/mirasim*.png` (theme-aware via
`BrandMark.tsx`) and `apps/landing/public/brands/mirasim.png`; the DB `imageUrl`
points at the vendor's own asset on mirasim.ai.

The optional seed adds seven catalog entries and thirteen plans, without
credentials or a default admin account. Pool-backed products require real
stock before they can be purchased. Catalog upserts preserve operator edits.

1. **Category** (skip if it already exists): insert a `Category` row —
   `title`, unique `slug`, optional `emoji`, `sortOrder`, `isActive`. Easiest
   via the admin panel (`docs/ADMIN.md`) or `prisma studio` (`pnpm db:studio`).
2. **Product**: insert a `Product` row under that category — `title`, unique
   `slug`, `description`, optional `imageUrl`, and crucially `deliveryType`:
   - `STOCK_POOL` — pre-provisioned codes/accounts consumed one at a time
     from `StockItem` rows (`status=AVAILABLE`). Most common case (ChatGPT
     logins, Midjourney codes, Copilot seats).
   - `UNIQUE_CODE` — the code is generated at delivery time from a template
     in `Product.externalConfig.codeTemplate`, supporting the placeholders
     `{RANDOM8}`, `{NANOID}` and `{ORDER}` (e.g. `"SHOP-{RANDOM8}"`). If no
     `codeTemplate` is set, delivery falls back to consuming a `StockItem`
     exactly like `STOCK_POOL`, so pre-provisioned codes keep working.
   - `EXTERNAL_API` — delivery happens by calling a third-party API at
     fulfillment time; put connection details in `Product.externalConfig`
     (a `Json` column) and implement the call in the worker's delivery
     processor.
   - `MANUAL_FALLBACK` — no automated delivery; an admin is notified to
     fulfil manually (see `docs/ADMIN.md`).
3. **Plan(s)**: insert one or more `Plan` rows under the product — `title`
   (e.g. "1 month", "1 year"), optional `durationDays` (null = one-off,
   non-subscription good), `priceCents` (**integer USD cents**, never a
   float), optional `priceStars` (integer Stars override; if null the price
   is converted from `priceCents` at send-time), `discountPercent` (0-100),
   `lowStockThreshold` (drives the low-stock agent, see
   `docs/AGENT_PLAN.md`).
4. **Stock** (for `STOCK_POOL`/`UNIQUE_CODE` products): for each unit, encrypt
   the payload with `@tgshop/core`'s `encrypt()` (AES-256-GCM, format
   `v1:<iv>:<tag>:<ct>`) and
   insert a `StockItem` row with `payloadEnc` set to that ciphertext and
   `status=AVAILABLE`. Never store plaintext codes in the database.
5. Set `Product.isActive` / `Plan.isActive` to `true` once stock is loaded —
   the Mini App only lists active products/plans.

## How to add a new payment provider

1. Add the new value to the `PaymentProvider` enum in
   `packages/db/prisma/schema.prisma` and run a Prisma migration
   (`pnpm db:migrate`).
2. Implement a provider module in `apps/bot/src/payments/` next to
   `cryptobot.ts` and `stars.ts` (create invoice, verify webhook signature,
   map provider status → `PaymentStatus`, map to `OrderStatus` transitions per
   `docs/PAYMENTS.md`'s state diagram).
3. Add a webhook/ingestion route in `apps/bot` (for push-style providers like
   CryptoBot) or a polling job in `apps/worker` (for pull-style providers like
   TRON), following the same idempotency pattern as the existing providers:
   look up by `(provider, providerInvoiceId)` or `(provider, txHash)` before
   writing, since both are `@@unique` constraints designed for this.
4. Add corresponding failure-mode documentation to `docs/PAYMENTS.md`
   (double-spend / missed webhook / underpayment / late payment / refund, at
   minimum) and a Bruno webhook simulator under
   `bruno/tgshop/webhook-simulators/`.
5. Surface the new provider as a payment option in `apps/miniapp`'s checkout
   UI and in the bot's inline payment menu.

## Scripts reference

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode via Turborepo |
| `pnpm build` | Build all apps/packages |
| `pnpm lint` / `pnpm typecheck` | Lint / typecheck the whole monorepo |
| `pnpm test` | Unit + integration tests (`@tgshop/core`, `@tgshop/worker`, `@tgshop/bot`) |
| `pnpm test:e2e` | End-to-end tests against a real Postgres (see `e2e/`) |
| `pnpm db:migrate` / `db:push` / `db:seed` / `db:studio` / `db:generate` | Prisma workflows against `@tgshop/db` |
| `./scripts/gen-keys.sh` | Generate `ENCRYPTION_KEY`/`JWT_SECRET`/`SESSION_SECRET`/`WEBHOOK_SECRET`/`SERVICE_TOKEN` |
| `./scripts/setup-webhook.sh [set\|info\|delete]` | Manage the Telegram webhook |
| `./scripts/backup-postgres.sh` | Nightly `pg_dump` + gzip + rotation |
| `./scripts/restore-postgres.sh <file.sql.gz>` | Restore from a backup |
| `node scripts/create-admin.mjs --email <email> --role OWNER` | Create (or reset) an admin account with a real bcrypt hash — **the only way to get a usable login**, see `docs/ADMIN.md` |
| `node scripts/verify-api.mjs` | Smoke-tests the bot's `/api` + `/internal` auth surface against a booted Fastify instance |
| `node scripts/verify-seed.mjs` | Checks catalog shape, Mirasim, and absence of sellable seed credentials |
| `node scripts/verify-broadcast.mjs` | Drives the broadcast lifecycle (arm → cancel → re-arm → sweep) against real Postgres + Redis |
| `node scripts/fake-trongrid.mjs` | Stub TronGrid server for exercising `chain-scan` without touching a real chain |

The three `verify-*` scripts and `create-admin.mjs` need a live Postgres/Redis
and the environment loaded first (`node --env-file=.env scripts/verify-api.mjs`, for example), and they
import from `dist/`, so run `pnpm build` before them. Each prints `PASS`/`FAIL` per check and exits
non-zero on the first failure, so they drop straight into CI. `verify-broadcast`
cleans up every row and queue job it creates, but it does write to the database
it is pointed at — point it at a dev database, not production.

Never commit a `*.tsbuildinfo` file (they are gitignored — keep it that way).
`tsc -b` trusts that cache to decide what to re-emit, and `dist/` is gitignored,
so a clone that has the cache but no output builds "successfully" while emitting
nothing — and then every `dist/` import above fails with
`ERR_MODULE_NOT_FOUND`. If a build ever looks suspiciously empty, delete the
caches and rebuild: `find . -name '*.tsbuildinfo' -not -path '*/node_modules/*'
-delete && pnpm build`.
