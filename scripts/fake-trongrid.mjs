#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Fake TronGrid — a local stand-in for https://api.trongrid.io so the TRON
// deposit pipeline can be exercised end to end without a testnet wallet,
// faucet, or network access.
//
// TRON has no push webhooks: the worker POLLS TronGrid. So the honest way to
// simulate a deposit is to make the poller see one, not to invent a webhook
// endpoint the app does not have. Point the worker at this server and the
// REAL apps/worker code path runs — amount-tag matching, confirmation counting,
// under/overpayment classification, settlement and delivery all included.
//
// Usage:
//   node scripts/fake-trongrid.mjs                  # listens on 8099
//   PORT=9000 node scripts/fake-trongrid.mjs
//
// Then run the worker against it:
//   TRONGRID_API_BASE=http://localhost:8099 pnpm --filter @tgshop/worker dev
//
// Queue a deposit (see bruno/tgshop/webhook-simulators/, or curl directly):
//   curl -X POST http://localhost:8099/_sim/transfer \
//     -H 'content-type: application/json' \
//     -d '{"to":"<TRON_RECEIVE_ADDRESS>","amount6":"9990123"}'   # amount = the tagged sum shown to the buyer
//
// Implements only the four endpoints apps/worker/src/lib/trongrid.ts calls.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8099)
const USDT_CONTRACT = process.env.TRON_USDT_CONTRACT ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

/** Simulated chain height. Advances on demand so confirmations can be tested. */
let blockNumber = 60_000_000
/** @type {Array<{transaction_id: string, to: string, from: string, value: string, block: number, block_timestamp: number, token_info: {address: string, decimals: number, symbol: string}}>} */
const transfers = []
/** TRX balances in SUN, keyed by address. Used by the low-TRX / energy checks. */
const trxBalances = new Map()

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname

  // ── Simulation control plane (not part of the real TronGrid API) ──────────

  if (req.method === 'POST' && path === '/_sim/transfer') {
    const body = await readJson(req)
    if (!body.to || !body.amount6) {
      return json(res, 400, { error: 'to and amount6 are required' })
    }
    // Mined `confirmations` blocks ago, so the worker's confirmation gate sees
    // a realistic depth instead of everything landing at the chain tip.
    const depth = Number(body.confirmations ?? 20)
    const transfer = {
      transaction_id: body.txId ?? `sim-${Date.now().toString(16)}-${transfers.length}`,
      to: body.to,
      from: body.from ?? 'TSimulatedSenderAddress000000000000',
      value: String(body.amount6),
      block: blockNumber - depth,
      block_timestamp: Date.now() - depth * 3000,
      token_info: { address: body.contract ?? USDT_CONTRACT, decimals: 6, symbol: 'USDT' }
    }
    transfers.push(transfer)
    return json(res, 200, { ok: true, transfer, chainTip: blockNumber })
  }

  if (req.method === 'POST' && path === '/_sim/advance') {
    const body = await readJson(req)
    blockNumber += Number(body.blocks ?? 1)
    return json(res, 200, { ok: true, blockNumber })
  }

  if (req.method === 'POST' && path === '/_sim/trx-balance') {
    const body = await readJson(req)
    trxBalances.set(body.address, Number(body.sun ?? 0))
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && path === '/_sim/reset') {
    transfers.length = 0
    trxBalances.clear()
    blockNumber = 60_000_000
    return json(res, 200, { ok: true })
  }

  // ── TronGrid API surface actually used by apps/worker ─────────────────────

  // GET /v1/accounts/:address/transactions/trc20
  const trc20 = /^\/v1\/accounts\/([^/]+)\/transactions\/trc20$/.exec(path)
  if (req.method === 'GET' && trc20) {
    const address = trc20[1]
    return json(res, 200, { success: true, data: transfers.filter((t) => t.to === address), meta: {} })
  }

  // GET /v1/accounts/:address  → TRX balance
  const account = /^\/v1\/accounts\/([^/]+)$/.exec(path)
  if (req.method === 'GET' && account) {
    const address = account[1]
    return json(res, 200, { success: true, data: [{ address, balance: trxBalances.get(address) ?? 0 }] })
  }

  // POST /wallet/getnowblock → current chain tip
  if (req.method === 'POST' && path === '/wallet/getnowblock') {
    return json(res, 200, { block_header: { raw_data: { number: blockNumber, timestamp: Date.now() } } })
  }

  // POST /wallet/triggerconstantcontract → read-only contract call (balanceOf)
  if (req.method === 'POST' && path === '/wallet/triggerconstantcontract') {
    const body = await readJson(req)
    const owner = body.owner_address
    const total = transfers
      .filter((t) => t.to === owner)
      .reduce((sum, t) => sum + BigInt(t.value), 0n)
    return json(res, 200, {
      result: { result: true },
      constant_result: [total.toString(16).padStart(64, '0')]
    })
  }

  // POST /wallet/broadcasttransaction → accept and echo, so sweeps "succeed"
  if (req.method === 'POST' && path === '/wallet/broadcasttransaction') {
    const body = await readJson(req)
    return json(res, 200, { result: true, txid: body.txID ?? `sim-sweep-${Date.now().toString(16)}` })
  }

  json(res, 404, { error: `fake-trongrid: unhandled ${req.method} ${path}` })
})

server.listen(PORT, () => {
  console.log(`fake-trongrid listening on http://localhost:${PORT}`)
  console.log(`  chain tip: block ${blockNumber}`)
  console.log(`  point the worker at it with TRONGRID_API_BASE=http://localhost:${PORT}`)
})
