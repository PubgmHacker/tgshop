# Agent plan

This document describes how a future LLM agent (running as a scheduled job,
a chat-triggered assistant, or a standalone service) plugs into tgshop
without needing direct database access: entirely through the Redis Streams
event bus (read-side) and a small set of `/internal/*` HTTP endpoints
(read+write side), both already used internally by `apps/worker`.

Everything below is additive to the system described in
`docs/ARCHITECTURE.md` and `docs/PAYMENTS.md` — the agent is just another
consumer/caller of infrastructure that already exists for the worker's own
use, authenticated the same way (`SERVICE_TOKEN` bearer header).

## Design principles

1. **Read from the event bus, write through `/internal/*`.** The agent
   should never get direct Postgres/Redis credentials — it authenticates to
   `apps/bot`'s `/internal/*` API with `SERVICE_TOKEN`, exactly like
   `apps/worker` does. This keeps one enforcement point for the order state
   machine, ledger idempotency, and audit logging.
2. **Propose, don't execute, for anything user-facing or financial by
   default.** Broadcast posts default to `BroadcastPost.status=DRAFT`; a
   human `ADMIN` approves and sends from `docs/ADMIN.md`'s panel. Refunds,
   promo creation, and catalog edits triggered by the agent are always
   logged to `AuditLog` with `actorType="agent"` and, for anything above a
   configurable risk threshold, land in a pending-approval queue rather than
   applying immediately (see "Anomaly flags" below).
3. **Idempotent by construction.** Every `/internal/*` write the agent makes
   takes the same idempotency keys the rest of the system does
   (`Order.idempotencyKey`, `IdempotencyRecord` for ledger writes) — an
   agent retry after a timeout is always safe.

## Redis Streams event bus

Stream key prefix: `tgshop:events:`. Each stream entry is a flat field/value
map (Redis Streams don't nest JSON well); complex payloads are JSON-encoded
into a single `data` field. Consumers should use a consumer group
(`XGROUP CREATE ... $ MKSTREAM`) named after themselves, e.g.
`agent:promo-writer`, so multiple agent processes can share a stream without
double-processing, and so a restarted agent resumes from its last
acknowledged entry (`XACK`) rather than replaying history.

### Emitted today

These are the events `@tgshop/core`'s `publishEvent()` actually writes. The
`EventName` union in `packages/core/src/events.ts` is the source of truth — it
is a closed union, so an event not listed there cannot be published at all.

| Stream | Event `type` field | Emitted when | Payload (`data` JSON) fields |
| --- | --- | --- | --- |
| `tgshop:events:orders` | `order.paid` | `Order.status` transitions to `PAID` | `orderId, userId, planId, provider, amountCents` |
| `tgshop:events:orders` | `order.delivered` | `Order.status` transitions to `DELIVERED` | `orderId, userId, planId, deliveredAt` |
| `tgshop:events:orders` | `order.failed` | delivery fails after retries exhausted | `orderId, reason` |
| `tgshop:events:payments` | `payment.received` | a payment is confirmed on any rail | `paymentId, orderId, userId, provider, amount, asset` |
| `tgshop:events:payments` | `payment.underpaid` | a `TRON_TRC20` deposit is short | `orderId, paymentId, expected6, received6` |
| `tgshop:events:payments` | `payment.reconcile_mismatch` | reconciliation finds a provider/DB disagreement: a provider-paid invoice with no linked order (`kind="paid_no_order"`) or one whose order already closed EXPIRED/FAILED/REFUNDED (`kind="paid_order_closed"`) | `provider, paymentId, orderId, kind, detail` |
| `tgshop:events:orders` | `order.refunded` | `refundOrder()` commits — from the admin panel, or from `POST /internal/orders/:id/refund` at/below the auto-approval ceiling | `orderId, userId, planId, refundedCents, reason, refundedBy` |
| `tgshop:events:stock` | `stock.low` | a plan's `AVAILABLE` `StockItem` count drops to/below `lowStockThreshold` | `planId, productId, available, threshold` |
| `tgshop:events:stock` | `stock.depleted` | a delivery draws a pool-backed plan to exactly zero `AVAILABLE` (fires alongside that delivery's `stock.low`) | `planId, productId` |
| `tgshop:events:users` | `user.registered` | a new `User` row is created (first `/start` or first Mini App auth) | `userId, tgId, referredById` |
| `tgshop:events:subs` | `subscription.expiring_soon` | the `subs-remind` sweep sends a 3-day or 1-day expiry reminder (deduped per window by `remindedAt`) | `subscriptionId, userId, planId, expiresAt, daysLeft` |
| `tgshop:events:broadcasts` | `broadcast.sent` | a `BroadcastPost` fan-out finishes and the post reaches `SENT` (a `FAILED` fan-out emits nothing) | `postId, total, sent, blocked, failed, sentAt` |

Every entry also carries `emittedAt` (ISO timestamp) and `schemaVersion`
(`"1"` today) fields alongside `type`/`data`, so consumers can safely ignore
unknown future event types on a stream rather than erroring.

### Adding a new event

Every event this plan originally proposed is emitted today (table above).
Adding a future one means extending the `EventName` union, `EventPayloads`
and the stream map in `packages/core/src/events.ts` (the union is closed, so
an unlisted event cannot be published at all), then publishing it from the
owning edge — after the transaction commits, never inside it. The mapping is
pinned by `packages/core/src/__tests__/events.test.ts`.

## `/internal/*` endpoints available to the agent

All require `Authorization: Bearer ${SERVICE_TOKEN}`. See
`bruno/tgshop/internal-api/` for runnable examples. Every endpoint in this
table is live; `apps/bot/src/server/routes/internal/` is the source of truth.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/internal/stats` | `GET` | Revenue by day/week/month, orders by status, ARPU, conversion. The agent's read model for "how is the shop doing". |
| `/internal/stock` | `GET` | Stock levels for every plan, with low-stock flags. |
| `/internal/stock/low` | `GET` | Only the plans currently at/below `lowStockThreshold`, with product/category context for writing a relevant promo post. |
| `/internal/top-products` | `GET` | Best sellers, for choosing what to promote. |
| `/internal/orders?status=` | `GET` | Orders filtered by status — used to spot stale `PENDING` or piling-up `FAILED` orders. |
| `/internal/posts` | `POST` | Create a `BroadcastPost` (`source=AGENT`, defaults to `status=DRAFT`). |
| `/internal/posts/:id/publish` | `POST` | Publish or schedule an existing post. |
| `/internal/broadcasts` | `POST` | Enqueue a broadcast send to the worker's queue. |
| `/internal/reconcile` | `POST` | Trigger an on-demand reconciliation pass for one provider (see `docs/PAYMENTS.md`). Enqueues the worker's existing sweep — `payments-poll` for `CRYPTOBOT`, `chain-scan` for `TRON_TRC20` — rather than reconciling in the request; `BALANCE`/`STARS` are rejected (no external record to disagree with). The agent calls this on a suspiciously stale `PENDING`/`CONFIRMING` `Payment` rather than diagnosing the provider API itself. |
| `/internal/anomalies` | `POST` | Record an anomaly flag (see below) as an `AuditLog` row (`actorType="agent"`, `action="anomaly.flagged"`) for the admin **Audit log**/dashboard to surface, without taking any mutating action itself. Evidence is capped at 16 KB serialized. |
| `/internal/orders/:id/refund` | `POST` (gated) | Issue a refund for an order at/below the `refund_auto_approve_ceiling_cents` `Setting` (default 1000 = $10; 0 sends everything to a human). Above the ceiling it mutates nothing and records one pending-approval `AuditLog` row (`action="order.refund_requested"`) for a human `ADMIN`. Retry-safe: an already-`REFUNDED` order answers 200 with `alreadyRefunded=true`, and repeat above-ceiling requests do not duplicate the pending entry. |

## Capability 1: auto-generate channel promo posts

**Trigger**: scheduled (e.g. daily) or reactive to `stock.low`/
`order.paid`-volume spikes on `tgshop:events:stock`/`tgshop:events:orders`.

**Flow**:
1. Consumer group `agent:promo-writer` reads new entries from
   `tgshop:events:stock` and `tgshop:events:orders`.
2. On a schedule, also calls `GET /internal/stock/low` for a full current
   snapshot (the stream only carries deltas since last read).
3. Drafts channel copy (RU/EN per `docs/PAYMENTS.md`-style externalized
   strings — the agent should never hardcode a single locale) referencing
   real `Product.title`/`Plan.title`/pricing pulled from the same response.
4. `POST /internal/broadcasts` with `source: "AGENT"`, `status` left as the
   endpoint's `DRAFT` default (no `scheduledAt` unless the agent has high
   confidence in timing, e.g. "send during evening peak hours" backed by
   `BroadcastPost.statsJson` history).
5. A human reviews/edits/approves in `docs/ADMIN.md`'s broadcast panel
   before anything reaches `tgshop.SENDING`.

## Capability 2: react to low stock

**Trigger**: `stock.low` / `stock.depleted` entries on
`tgshop:events:stock`.

**Flow**:
1. On `stock.low`, feed into Capability 1 (promo post) if the plan is a
   good candidate for a "act fast, limited stock" angle, or into a
   restock-reminder path otherwise (e.g. notify the `ADMIN`/`OWNER` — via
   the admin panel's notification surface, not directly via bot DM, so it's
   auditable).
2. On `stock.depleted`, the agent should *not* silently disable the
   product/plan (that's a catalog edit with real revenue impact) — instead
   it flags via `POST /internal/anomalies` with severity `high`,
   for a human to decide whether to disable, restock, or leave listed with
   an "out of stock, restocking soon" note.

## Capability 3: reconcile payments against orders

**Trigger**: scheduled sweep, or reactive to `payment.reconcile_mismatch`
entries the worker's own reconciliation job already emits.

**Flow**:
1. The heavy lifting (querying CryptoBot/TronGrid, comparing to local
   `Payment` rows) is already implemented by the worker's reconciliation
   job and exposed via `POST /internal/reconcile` — the agent's job here is
   orchestration and judgment, not reimplementing that logic: decide *when*
   to trigger an out-of-band pass (e.g. a support ticket mentions "I paid
   but nothing arrived") and *what to do* with a mismatch that reconciliation
   surfaces but doesn't auto-resolve (per `docs/PAYMENTS.md`, ambiguous
   cases like a `txHash` whose amount carries no open invoice tag
   exactly are left as `payment.reconcile_mismatch` events rather than
   guessed at automatically).
2. On a mismatch, the agent gathers context (order history, user's other
   payments) via read-only `/internal/*`/`/api/*` calls and either: (a) if
   the numbers correctly imply a `PAID` order (e.g. a late-arriving webhook
   the reconciliation pass already found and fixed), does nothing further;
   or (b) if genuinely ambiguous, calls `POST /internal/anomalies`
   rather than guessing, since a wrong auto-resolution here is a direct
   financial mistake.

## Capability 4: flag anomalies

**Trigger**: any of the above, plus standalone pattern-watching over
`tgshop:events:*` (e.g. a burst of `order.failed` from one `Product`,
repeated `UNDERPAID` payments from one `userId`, refund volume spiking).

**Flow**:
1. `POST /internal/anomalies` with `{ severity, category,
   summary, relatedEntity: { type, id }, evidence }` — purely additive,
   never mutates order/payment/stock state itself.
2. Surfaces in the admin **Audit log** (per `docs/ADMIN.md`) alongside
   human-made changes, so anomaly flags and the actions taken in response
   to them stay in one auditable timeline.
3. Severity thresholds (what counts as `high` vs `info`) live in `Setting`
   rows so `OWNER`s can tune sensitivity without a redeploy.

## What's NOT delegated to the agent

- Rotating `ENCRYPTION_KEY`/`JWT_SECRET`/`WEBHOOK_SECRET`/`SERVICE_TOKEN`
  (`scripts/gen-keys.sh` is a human-run, deploy-time operation).
- Any direct on-chain TRON transaction (sweeps, refund payouts) — those stay
  in the worker's existing, narrowly-scoped sweep job.
- Creating/deleting `AdminUser` accounts or changing `AdminRole`.
- Sending a `BroadcastPost` without a human transitioning it out of `DRAFT`
  (agent-authored posts always require approval per the design principles
  above), unless a future `OWNER`-configured `Setting` explicitly opts a
  narrow category (e.g. "automated low-stock alerts only") into
  auto-send — not the default, and out of scope for the initial
  implementation this plan describes.
