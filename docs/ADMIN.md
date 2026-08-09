# Admin

`apps/admin` is a Next.js 14 App Router panel for shop operators, backed by
`AdminUser` (`AdminRole`: `OWNER`, `ADMIN`, `SUPPORT`) and talking to
`apps/bot`'s `/api/*`/`/internal/*` endpoints (JWT session, `JWT_SECRET`).

## Roles

| Role | Can do |
| --- | --- |
| `OWNER` | Everything below, plus manage `AdminUser` accounts and rotate secrets/settings. |
| `ADMIN` | Manage catalog (categories/products/plans/stock), promos, view/refund orders, send broadcasts, view audit log. |
| `SUPPORT` | View orders/users/payments, issue balance refunds, respond to `MANUAL_FALLBACK` delivery tickets. Cannot edit catalog, promos, or broadcasts. |

## Logging in

Navigate to `https://admin.<domain>` and sign in with an `AdminUser.email` +
password. **The seed script (`packages/db/prisma/seed.ts`) inserts a demo
`AdminUser` with a placeholder `passwordHash` (`seed$<sha256>`, not a real
bcrypt hash) — this is not a usable login as-is.** Before going live:

1. Implement (or confirm `@tgshop/core`/the admin app's auth flow
   implements) real password hashing (bcrypt/argon2) and a "first login sets
   your real password" or a proper admin-invite flow.
2. Replace the seeded placeholder row via that real flow, or delete it and
   create a fresh `OWNER` account through it — never ship the seed hash to
   production.
3. Optionally enable TOTP (`AdminUser.totpSecret` is already in the schema)
   for second-factor login.

## What's manageable from the admin panel

- **Catalog**: create/edit `Category`, `Product` (including
  `deliveryType` and `externalConfig` for `EXTERNAL_API` products), `Plan`
  (pricing, duration, discount, low-stock threshold).
- **Stock**: bulk-upload `StockItem` payloads (encrypted server-side before
  storage — the admin UI never round-trips plaintext through the browser
  more than once), view `AVAILABLE`/`RESERVED`/`SOLD` counts per plan.
- **Orders**: search/filter by user, status, provider, date range; view full
  `Order` → `Payment` → `BalanceTransaction` chain for a given order; issue a
  refund (writes a `LedgerType.REFUND` `BalanceTransaction` and sets
  `Order.status=REFUNDED`, per `docs/PAYMENTS.md`'s refund policy).
- **Users**: view a user's orders/balance/subscriptions; block/unblock
  (`User.isBlocked`).
- **Promos**: create/edit `Promo` codes (`PERCENT`/`FIXED`, max uses,
  expiry, optionally scoped to one `Plan`).
- **Broadcasts**: compose a `BroadcastPost` (manual `source=MANUAL`), review
  and approve/reject agent-drafted posts (`source=AGENT`, see
  `docs/AGENT_PLAN.md`), schedule or send immediately, view delivery stats
  (`statsJson`).
- **Manual fallback queue**: `Order`s on `MANUAL_FALLBACK` products land in a
  worklist for `SUPPORT`/`ADMIN` to fulfil by hand, then mark delivered
  (writes `Order.deliveredPayloadEnc` via the same `@tgshop/core` `encrypt()`
  path as automated delivery, so the ciphertext format stays consistent).
- **Audit log**: read-only view over `AuditLog` — every admin/agent mutation
  (refund, catalog edit, broadcast send, settings change) is recorded with
  `actorType`, `actorId`, `action`, `entity`/`entityId`, and a `diff`.
- **Settings**: shop-wide `Setting` key/value pairs (e.g. feature flags,
  displayed rates) validated via `@tgshop/core`'s `SettingsValidationError`
  path before being persisted.

## Operational notes

- All admin mutations should go through `/internal/*` or an
  admin-authenticated subset of `/api/*` on `apps/bot`, never write to
  Postgres directly from `apps/admin` — this keeps `AuditLog` writes and
  domain invariants (order state machine, ledger idempotency) in one place.
- Refunds and catalog edits performed by an agent (see
  `docs/AGENT_PLAN.md`) show up in the same admin **Audit log** view with
  `actorType="agent"`, so operators have one place to review both human and
  automated changes.
