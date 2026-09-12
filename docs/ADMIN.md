# Admin

`apps/admin` is a Next.js 15 App Router panel for shop operators, backed by
`AdminUser` (`AdminRole`: `OWNER`, `ADMIN`, `SUPPORT`). Its server actions use
Prisma and a signed HttpOnly session cookie (`SESSION_SECRET`). The Telegram
admin Mini App uses the separate JWT-protected `/api/admin/*` surface.

## Roles

| Role | Can do |
| --- | --- |
| `OWNER` | Everything below, plus manage `AdminUser` accounts and rotate secrets/settings. |
| `ADMIN` | Manage catalog (categories/products/plans/stock), promos, view/refund orders, send broadcasts, view audit log. |
| `SUPPORT` | View orders/users/payments, issue balance refunds, respond to `MANUAL_FALLBACK` delivery tickets. Cannot edit catalog, promos, or broadcasts. |

## Logging in

Navigate to `https://admin.<domain>` and sign in with an `AdminUser.email` +
password, or — if the Telegram widget is configured (below) — with the
"Sign in with Telegram" button underneath the form.

Hashing is already implemented and needs nothing from you: `loginAction()`
compares the submitted password against a real bcrypt hash, and against a
static dummy hash when the email is unknown, so response timing does not reveal
which accounts exist. A `totpSecret` on the account makes a valid 6-digit code
mandatory as well.

What does **not** exist is any way to create an account from the UI. There is no
"manage admins" page, the Telegram widget path deliberately never creates
admins, and the database seed creates no admin credentials. **A fresh deployment
therefore has no usable login until you create one**, using
`scripts/create-admin.mjs` — it needs
`DATABASE_URL` in the environment and a prior `pnpm build`:

```bash
set -a; source .env; set +a

# 1. Create a real OWNER. Omitting --password generates a strong one and prints
#    it exactly once; only its bcrypt hash is ever stored.
node scripts/create-admin.mjs --email you@example.com --role OWNER

# 2. Sign in and confirm the new account works.
```

The script refuses to delete the last remaining `OWNER`. Re-running step 1 for an
existing email resets that account's password, which is also the recovery path
for a locked-out owner — there is no self-service password reset.

### Optional: sign in with Telegram instead of a password

1. Set `BOT_TOKEN` and `BOT_USERNAME` for the admin app. The login page hides
   the widget entirely when `BOT_USERNAME` is unset.
2. In [@BotFather](https://t.me/BotFather): `/setdomain` → your bot → the admin
   domain (`admin.<domain>`). Telegram refuses to render the widget on any
   other origin.
3. Provision the account. The `tg:<telegram_id>` email is a hard convention —
   `telegramLoginAction()` looks up exactly that string, so a typo produces an
   account that exists but can never sign in:
   ```bash
   node scripts/create-admin.mjs --telegram-id 123456789 --role ADMIN
   ```

Telegram redirects back to `/api/telegram-login`, which re-derives the HMAC
over the signed payload with the bot token, rejects anything older than 24
hours, and issues a session only if that `tg:<id>` row already exists.

### Optional: TOTP second factor

The verification path is wired (`AdminUser.totpSecret`, checked on every
password login), but **enrolment has no UI yet**. The helpers exist in
`apps/admin/src/lib/totp.ts` — `generateTotpSecret()` and `totpKeyUri()`, the
latter producing an `otpauth://` URI for a QR code — so enabling 2FA today means
generating a secret, writing it to the row yourself, and scanning the URI.
Note that a TOTP secret is a bearer credential in plaintext in the database;
treat adding an enrolment flow and encrypting the column as prerequisites for
relying on it.

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

- Admin mutations write to Postgres directly, through `'use server'` actions in
  `apps/admin/src/lib/actions/*`. Each action is responsible for calling
  `requireRole()` first, validating its input with the Zod schema in
  `apps/admin/src/lib/schemas.ts`, and calling `writeAuditLog()` after the
  write — the three things an HTTP hop to `apps/bot` would otherwise have
  enforced for it.
- What must NOT be reimplemented here is domain logic. Anything that touches
  the order state machine, the balance ledger, or stock reservation goes
  through `@tgshop/core` (`refundOrder`, `expireOrder`, `assertTransition`,
  `releasePromoUse`), because those carry invariants — idempotency keys,
  promo-use release, allowed transitions — that a second implementation
  silently drops. The admin refund action calling core's `refundOrder` rather
  than writing `status: REFUNDED` itself is the pattern to follow.
- Refunds and catalog edits performed by an agent (see
  `docs/AGENT_PLAN.md`) show up in the same admin **Audit log** view with
  `actorType="agent"`, so operators have one place to review both human and
  automated changes.


## September 2026 security changes

Password login uses an atomic Redis rate limit (10 attempts per account per
15 minutes and a global 300 per minute). Redis failure refuses login. Existing
sessions recheck the administrator record and current role on every action.
Telegram widget login does not bypass configured two-factor authentication.

Supplier JSON configuration is available only to ADMIN/OWNER. Product audit
entries record that configuration changed without copying its credentials;
clearing the editor now clears the saved configuration. Earlier audit records
are not rewritten automatically.

External delivery requires HTTPS and public IP addresses. DNS answers are
validated and the selected IP is pinned to the request; redirects and reserved
HTTP headers are rejected. Responses are limited to 256 KiB, and the delivery
timeout cancels the network request. Providers must deduplicate the stable
`Idempotency-Key: delivery:<orderId>` across retries. Cancellation cannot undo
an operation already completed by a remote provider.
