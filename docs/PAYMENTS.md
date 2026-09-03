# Payments

All four `PaymentProvider` values — `BALANCE`, `CRYPTOBOT`, `STARS`,
`TRON_TRC20` — share one state machine on `Order.status`
(`PENDING → PAID → DELIVERING → DELIVERED`, with `FAILED`/`EXPIRED`/
`REFUNDED` as terminal off-ramps) and a parallel `Payment.status`
(`PENDING → CONFIRMING → PAID`, with `UNDERPAID`/`EXPIRED`/`FAILED`
off-ramps). Money is always integer: `amountCents` (Int) for USD,
`Payment.amount` (BigInt) interpreted per-`asset` (USDT: 6 decimals, Stars:
whole units).

## Idempotency

Every provider write path is protected by one of:

- `Order.idempotencyKey` (`@unique`) — the client-supplied key for
  `POST /api/orders`; a retried request with the same key returns the
  existing order rather than creating a duplicate.
- `Payment` `@@unique([provider, txHash])` and
  `@@unique([provider, providerInvoiceId])` — a webhook or poll result that
  matches an already-processed `(provider, txHash)`/`(provider,
  providerInvoiceId)` pair is a no-op, not a double-credit. Both indexes
  are on nullable columns; Postgres treats `NULL` as distinct from `NULL`,
  so this only constrains rows where the pair is actually populated
  (intentional — plenty of `Payment` rows never get a `txHash`, e.g. Stars).
- `IdempotencyRecord` (scope `"ledger"`) — every `BalanceTransaction` write
  via `@tgshop/core`'s `credit()`/`debit()` is keyed by an idempotency key
  and short-circuits to the previously computed result if replayed.

## Per-provider flows

### BALANCE

```mermaid
sequenceDiagram
    participant U as User
    participant B as bot API
    participant DB as Postgres

    U->>B: POST /api/orders (provider=BALANCE)
    B->>DB: begin tx
    B->>DB: core.debit(user, totalCents) — advisory-locked, idempotent
    alt insufficient balance
        DB-->>B: InsufficientBalanceError
        B-->>U: 402 + current balance
    else sufficient
        B->>DB: Order.status=PAID, paidAt=now
        B->>DB: commit tx
        B-->>U: order PAID, delivery enqueued
    end
```

No external round-trip — the debit and the `Order.status=PAID` transition
happen in the same Postgres transaction, so this path has no webhook/polling
failure modes of its own (see "Refund" below for the reverse direction).

### CRYPTOBOT

```mermaid
sequenceDiagram
    participant U as User
    participant B as bot API
    participant CB as CryptoBot API
    participant DB as Postgres

    U->>B: POST /api/orders (provider=CRYPTOBOT)
    B->>CB: createInvoice(amount, asset, payload=orderId)
    CB-->>B: invoice_id, pay_url
    B->>DB: Payment(status=PENDING, providerInvoiceId=invoice_id)
    B-->>U: pay_url (opens CryptoBot mini app)
    U->>CB: pays invoice
    CB->>B: POST /webhook/cryptobot (update_type=invoice_paid, signed)
    B->>B: verify Crypto-Pay-API-Signature (HMAC-SHA256, see below)
    B->>DB: lookup Payment by (CRYPTOBOT, invoice_id) — idempotent
    B->>DB: Payment.status=PAID, Order.status=PAID
    B->>Q: enqueue delivery job
```

**Signature verification**: CryptoBot signs the raw JSON body with
`HMAC_SHA256(secret_key, body)` where `secret_key = SHA256(CRYPTOBOT_API_TOKEN)`
(raw bytes, not hex), hex-encoded, sent in the `Crypto-Pay-API-Signature`
header. Verify with a constant-time comparison
(`@tgshop/core`'s `safeEqual()`). See
`bruno/tgshop/webhook-simulators/cryptobot-invoice-paid.bru` for a working
signing snippet you can run locally.

### STARS

```mermaid
sequenceDiagram
    participant U as User (Telegram client)
    participant B as bot (grammY)
    participant TG as Telegram Bot API

    U->>B: POST /api/orders (provider=STARS)
    B->>TG: sendInvoice(currency="XTR", prices=[{amount: starsInt}], payload=orderId)
    TG-->>U: native Telegram payment sheet
    U->>TG: confirms payment
    TG->>B: pre_checkout_query
    B->>TG: answerPreCheckoutQuery(ok=true) — must respond within 10s
    TG->>B: message with successful_payment (telegram_payment_charge_id)
    B->>B: lookup Order by payload=orderId — idempotent
    B->>DB: Payment.status=PAID, Order.status=PAID
```

Stars amounts are always the integer computed by
`usdCentsToStars()` — never re-derived from a float — so what the user is
charged always matches what `Order.amountCents` implies.

### TRON_TRC20 (USDT)

Every customer pays into **one static wallet** — the owner's own USDT-TRC20
address (`TRON_RECEIVE_ADDRESS`; the legacy name `TRON_SWEEP_TO_ADDRESS` is
accepted). The shop holds no keys, derives no addresses and never signs a
transaction: the worker only *reads* that wallet on TronGrid.

What tells one invoice from another is the **amount**. Each open invoice for a
given price gets a unique sub-cent tag in 0.0001-USDT steps
(`tronTaggedAmountUsdt6` in `@tgshop/core`): `$29.00` is shown as
`29.0057 USDT` to one buyer and `29.0058` to the next. There are 99 tags per
price; a tag is held while its payment is `PENDING`/`CONFIRMING`/`UNDERPAID`
and for a 30-minute grace after the 20-minute payment window, then released.
A Redis `SET NX` reservation closes the race between two checkouts allocating
in the same instant (`apps/bot/src/payments/tron.ts`).

```mermaid
sequenceDiagram
    participant U as User
    participant B as bot API
    participant W as worker (chain-scan)
    participant TG as TronGrid API
    participant DB as Postgres

    U->>B: POST /api/orders (provider=TRON_TRC20) or POST /api/topup
    B->>DB: Payment PENDING, amount = price + unique sub-cent tag
    B-->>U: receive address + EXACT tagged amount + expiresAt
    U->>U: sends exactly that amount from any wallet
    loop every 20 s
        W->>TG: /v1/accounts/{wallet}/transactions/trc20 (only_to, only_confirmed, USDT contract, 6 h lookback)
        TG-->>W: transfers that landed on the wallet
    end
    W->>DB: drop txids already recorded (Payment.txHash) or flagged (AuditLog)
    W->>W: matchTransfer(): exact amount -> unique tag -> unmatched
    alt order PENDING, in window, amount >= tagged
        W->>DB: Order PAID (CAS on status), Payment PAID, surplus -> balance
        W->>Q: enqueue delivery
    else order PENDING, short alone but earlier partials on balance cover it
        W->>DB: Order PAID (CAS), Payment PAID, remainder debited from balance, earlier UNDERPAID rows -> PAID
        W->>Q: enqueue delivery
    else order PENDING, amount short
        W->>DB: Payment UNDERPAID (keeps its tag), received -> balance, tell user the exact tagged remainder
    else order expired
        W->>DB: Payment PAID, full amount -> balance, notify
    else order already paid on another rail
        W->>DB: Payment PAID, full amount -> balance, notify + AuditLog anomaly + tron_double_paid admin alert
    else top-up (no order)
        W->>DB: Payment PAID, amount -> balance (ledger key topup:<paymentId>)
    else unmatched
        W->>DB: AuditLog anomaly (once per txid) + tron_unmatched admin alert
    end
```

**Confirmations.** TronGrid is queried with `only_confirmed=true`, so only
transfers in solidified blocks are ever returned, and a solidified TRON block
is final — there is no reorg to wait out. A matched transfer is therefore
settled in the same sweep that found it. `CONFIRMING` is the moment between
binding the tx to the invoice and the settlement transaction committing:
the bind is its own commit so a crash mid-settlement leaves a resumable
`CONFIRMING` row, which the next sweep finishes (`Payment.txHash` is what it
resumes from; `(provider, txHash)` is unique, so a tx can never bind twice).

**Unmatched transfers** — a round amount with no tag, a tag no open invoice
holds (paid after the grace, typo), or two open invoices sharing a tag — are
never guessed at. The worker writes an `AuditLog` row
(`entity=TronTransfer`, `entityId=<txid>`, `action=anomaly.flagged`) with the
sender, amount and reason — that row is also the dedupe so the alert fires
once — and enqueues a `tron_unmatched` admin notification. The money is
already in the owner's wallet; the operator credits the right user by hand.

**Second transfers.** An `UNDERPAID` invoice keeps holding its tag, and the
user is told the exact remainder to send — the shortfall rounded up to a whole
cent plus the invoice's own tag — so the follow-up is matched by tag. The new
transfer gets its own `Payment` row on the same order (`(provider, txHash)` is
unique). If it, together with the balance credits from the earlier partials,
covers the ask, the order is paid: the remainder is debited back from the
balance as the purchase (`LedgerType.PURCHASE`, key
`tron-underpaid-reclaim:<paymentId>`) and the earlier `UNDERPAID` rows close
as `PAID`. If the user has meanwhile spent those credits, the new transfer is
just one more short payment and is credited the same way.

Use `bruno/tgshop/webhook-simulators/tron-usdt-deposit.bru` (and the
`-underpayment` variant) to exercise this without a real transfer. They drive
`scripts/fake-trongrid.mjs`, a local stand-in for api.trongrid.io: TRON has
no push webhooks, so the only faithful simulation is one the real polling
code discovers. Point the worker at it with
`TRONGRID_API_BASE=http://localhost:8099`.

### No sweeping

Funds land directly in the owner's wallet, so there is nothing to
consolidate and no hot key anywhere in the system. The former per-invoice
deposit addresses (xpub derivation, energy top-ups, sweeper) were removed by
migration `20260902090000_drop_deposit_addresses`.

## Failure modes

### Double-spend / duplicate webhook delivery

**Risk**: CryptoBot (or any provider) redelivers the same webhook (network
retry, at-least-once delivery semantics), or a malicious actor replays a
captured payload.

**Mitigation**: every write path looks up the existing `Payment` by its
unique `(provider, providerInvoiceId)` or `(provider, txHash)` pair *before*
mutating state, and is a no-op if a matching `PAID` row already exists.
Signature verification rejects payloads that aren't from the real provider
(CryptoBot); TRON needs no such check because nothing is pushed to us — the
worker only ever believes transfers it read from TronGrid itself.
The `Order.status` transition itself uses `@tgshop/core`'s state-machine
guard (`OrderStateError` if an illegal transition, e.g. `DELIVERED → PAID`,
is attempted), so a duplicate "paid" signal after delivery cannot regress
the order.

### Missed webhook (CryptoBot never calls back)

**Risk**: the webhook HTTP request never arrives (network partition, DNS
issue, CryptoBot-side outage) even though the invoice was actually paid.

**Mitigation**: the worker's reconciliation job (scheduled every 30s, and
triggerable on demand via `POST /internal/reconcile`) re-queries CryptoBot's
`getInvoices` for every `Payment` still `PENDING`/`CONFIRMING` and applies
the same idempotent settlement the webhook would have: order payments settle
and deliver, `topup_*` payments credit the balance under the webhook's own
`topup:<paymentId>` ledger key. This is the same mechanism that would catch
a webhook-signature verification bug silently dropping legitimate callbacks.

### Underpayment (TRON)

**Risk**: user sends less USDT than the invoice asks (wrong amount, or a
wallet that deducts network fees from the send amount rather than adding
them).

**Mitigation**: `Payment.status=UNDERPAID` is a distinct state (not `FAILED`
— the funds did arrive, just not enough). The received amount is credited to
the user's balance immediately (`LedgerType.TOPUP`, key
`tron-underpaid:<paymentId>`), so nothing is stranded, and the user is told
the exact tagged remainder to send. They can either send that remainder — the
invoice keeps its tag, so the second transfer is recognised and, together with
the credited partial, pays the order — or top up by any rail and pay the order
from balance. Dust is never sent back on-chain: consolidating it out rarely
nets positive after fees.

### Late payment (after Order.expiresAt)

**Risk**: user pays after the order/invoice has already expired (CryptoBot
invoices and TRON deposit windows both have a configured TTL reflected in
`Order.expiresAt`).

**Mitigation**: the order is never silently resurrected days later with
stale pricing/stock assumptions. Per rail:

- **TRON**: `chain-scan` detects the deposit against the expired order,
  credits the full received amount to the user's `BalanceTransaction`
  ledger instead of delivering, and notifies the user — funds are not lost,
  and a fresh order can be placed from balance. The same path handles an
  order that another rail already paid (the user paid twice): the money goes
  to the balance too, and the sweep additionally writes an `AuditLog` anomaly
  and sends a `tron_double_paid` admin alert so an operator can offer a refund.
- **CryptoBot**: `payments-poll` finds the provider-paid invoice attached to
  the closed order, marks the `Payment` `PAID` (the provider's truth), and
  flags a reconcile mismatch (`kind="paid_order_closed"`) — an `AuditLog`
  anomaly row plus a `payment.reconcile_mismatch` event — for a human to
  decide between crediting balance and refunding through CryptoBot. The
  money sits with CryptoBot either way, so deliberately nothing is credited
  automatically.

### Refund

**Risk**: an order needs to be refunded post-delivery (chargeback risk,
customer support decision, delivered-but-defective stock).

**Mitigation**: refunds always land as a `BalanceTransaction`
(`LedgerType.REFUND`, positive `amountCents`) credited via `@tgshop/core`'s
`credit()` — never as a reversed on-chain TRON transfer or a CryptoBot
refund API call, both of which are unreliable/slow/fee-bearing for small
amounts. `Order.status` moves to `REFUNDED` (a terminal state; delivery is
not "undone" — the underlying `StockItem`/code is presumed compromised once
delivered and is not returned to the `AVAILABLE` pool). Every refund is
also written to `AuditLog` (`actorType="admin"` or `"agent"`) with the
reason in `diff`.

## Reconciliation & anomaly detection

`POST /internal/reconcile` (bearer-auth via `SERVICE_TOKEN`) and the
worker's scheduled equivalent walk `Payment` rows that are not yet in a
terminal state, re-check them against the provider's own source of truth
(CryptoBot `getInvoices`, TronGrid transaction history), and write any
mismatch to `AuditLog` for a human (or the future agent described in
`docs/AGENT_PLAN.md`) to review. This is the single mechanism that covers
missed webhooks, provider-side status flips, and stuck `CONFIRMING` payments
in one pass.
