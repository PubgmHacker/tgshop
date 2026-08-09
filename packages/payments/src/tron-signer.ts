import { createHash } from 'node:crypto'
import { utils as tronWebUtils } from 'tronweb'
import { PaymentConfigError, PaymentProviderHttpError } from './errors.js'
import { tronAddressToHex } from './tron-address.js'

// ─────────────────────────────────────────────────────────────────────────────
// Concrete TRON transaction builder / signer / broadcaster.
//
// This is the implementation behind the `signAndBroadcast` seam that `sweep()`
// takes as an injected dependency. It is deliberately split out so tests can
// substitute a fake without any network, while production wires the real one.
//
// WHY WE TALK TO TronGrid HTTP DIRECTLY INSTEAD OF USING `new TronWeb(...)`:
// tronweb's own HttpProvider does its I/O through axios, which cannot be
// intercepted by the `fetchImpl` dependency-injection pattern the rest of this
// package (and its test-suite) uses. So we use tronweb ONLY for the offline
// crypto primitive it is genuinely good at — `utils.crypto.signTransaction`,
// a pure secp256k1 signature over the transaction id — and keep every network
// call on the injectable `fetchImpl`. Result: the entire request/response
// shape is exercised in tests without hitting the chain.
//
// TRANSACTION LIFECYCLE (all three TRON tx types below follow it):
//   1. Ask a full node to BUILD the unsigned transaction (it fills in the
//      reference block, expiration and protobuf encoding for us).
//   2. VERIFY that txID == sha256(raw_data_hex) — see verifyTxIdMatchesRawData.
//   3. SIGN the txID offline with the address's own private key.
//   4. BROADCAST the signed envelope.
// ─────────────────────────────────────────────────────────────────────────────

/** ABI function selector for the TRC-20 transfer entrypoint. */
export const TRC20_TRANSFER_SELECTOR = 'transfer(address,uint256)'

/** An ABI word is 32 bytes = 64 hex characters. */
const ABI_WORD_HEX_LEN = 64

/**
 * Upper bound for a uint256 ABI argument. USDT amounts are nowhere near this,
 * but an out-of-range value would silently wrap when hex-encoded, so we reject
 * it instead.
 */
const UINT256_MAX = 2n ** 256n - 1n

/** Endpoint config; `TronConfig` from tron.ts structurally satisfies this. */
export interface TronGridEndpoint {
  tronGridBaseUrl: string
  tronGridApiKey: string
}

export interface TronSignerDeps {
  fetchImpl?: typeof fetch
}

export interface Trc20TransferRequest {
  /** base58 address that holds the tokens and pays the energy. */
  fromAddress: string
  /** Raw 32-byte hex private key controlling `fromAddress`. */
  privateKeyHex: string
  /** base58 destination address. */
  toAddress: string
  /** Amount in the token's smallest unit (USDT = 6 decimals). */
  amount: bigint
  /** base58 TRC-20 contract address. */
  contractAddress: string
  /** Hard cap, in SUN, on TRX burnt for energy by this call. */
  feeLimitSun: bigint
}

export interface TrxTransferRequest {
  fromAddress: string
  privateKeyHex: string
  toAddress: string
  amountSun: bigint
}

export type SignAndBroadcastTrc20 = (req: Trc20TransferRequest) => Promise<string>
export type SendTrx = (req: TrxTransferRequest) => Promise<string>

export interface TronSigner {
  /** Builds, signs and broadcasts a TRC-20 `transfer(address,uint256)` call. Resolves to the tx hash. */
  signAndBroadcastTrc20: SignAndBroadcastTrc20
  /** Builds, signs and broadcasts a native TRX transfer (used to fund energy). Resolves to the tx hash. */
  sendTrx: SendTrx
}

// ── ABI encoding ───────────────────────────────────────────────────────────

/**
 * ABI-encodes the arguments of `transfer(address,uint256)` for TronGrid's
 * `parameter` field (arguments only — the selector travels separately in
 * `function_selector`, so there is NO 4-byte selector prefix here).
 *
 * Layout, 2 words / 128 hex chars:
 *   word 0: recipient, 20-byte account id LEFT-padded to 32 bytes. Note the
 *           TRON 0x41 version byte is stripped — inside the EVM an address is
 *           the bare 20 bytes, and leaving 0x41 on would encode a different,
 *           unspendable recipient.
 *   word 1: amount as a big-endian uint256.
 */
export function encodeTrc20TransferParameter(toAddress: string, amount: bigint): string {
  if (amount <= 0n) {
    throw new PaymentConfigError(`TRC-20 transfer amount must be positive, got ${amount.toString()}`)
  }
  if (amount > UINT256_MAX) {
    throw new PaymentConfigError(`TRC-20 transfer amount exceeds uint256: ${amount.toString()}`)
  }
  const hex21 = tronAddressToHex(toAddress) // '41' + 40 hex chars, checksum-verified
  const accountId20 = hex21.slice(2)
  const addressWord = accountId20.padStart(ABI_WORD_HEX_LEN, '0')
  const amountWord = amount.toString(16).padStart(ABI_WORD_HEX_LEN, '0')
  return addressWord + amountWord
}

// ── Integrity check ────────────────────────────────────────────────────────

/**
 * A TRON transaction id is defined as sha256(raw_data protobuf bytes). The
 * signature produced in step 3 commits ONLY to that txID — never to the
 * raw_data we broadcast. So if a node (or anything between us and it) returned
 * a txID that is not the hash of the raw_data it also handed us, we would sign
 * one transaction and broadcast a different one. Recomputing the hash locally
 * closes that gap and costs one sha256.
 */
function verifyTxIdMatchesRawData(txID: string, rawDataHex: string): void {
  const computed = createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest('hex')
  if (computed !== txID.toLowerCase()) {
    throw new PaymentConfigError(
      `Refusing to sign: node returned txID ${txID} but sha256(raw_data) is ${computed}`
    )
  }
}

// ── HTTP plumbing ──────────────────────────────────────────────────────────

/** The subset of a TRON transaction envelope we need to read; extra fields are preserved verbatim. */
interface UnsignedTransaction {
  raw: Record<string, unknown>
  txID: string
  rawDataHex: string
}

function expectString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PaymentProviderHttpError(`TronGrid ${context}: missing/invalid "${field}"`, 200, value)
  }
  return value
}

/** TronGrid reports contract-level failures as hex-encoded UTF-8 in `message`. */
function decodeNodeMessage(message: unknown): string {
  if (typeof message !== 'string') return ''
  if (!/^[0-9a-fA-F]+$/.test(message) || message.length % 2 !== 0) return message
  return Buffer.from(message, 'hex').toString('utf8')
}

async function postJson(
  endpoint: TronGridEndpoint,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (endpoint.tronGridApiKey) {
    headers['TRON-PRO-API-KEY'] = endpoint.tronGridApiKey
  }
  const res = await fetchImpl(`${endpoint.tronGridBaseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    throw new PaymentProviderHttpError(`TronGrid ${path} failed`, res.status, await res.text())
  }
  return (await res.json()) as Record<string, unknown>
}

function toUnsignedTransaction(tx: Record<string, unknown>, context: string): UnsignedTransaction {
  const txID = expectString(tx.txID, 'txID', context)
  const rawDataHex = expectString(tx.raw_data_hex, 'raw_data_hex', context)
  verifyTxIdMatchesRawData(txID, rawDataHex)
  return { raw: tx, txID, rawDataHex }
}

/**
 * Signs `unsigned` offline and broadcasts it. Returns the tx hash.
 *
 * We rebuild the broadcast envelope as `{...unsigned.raw, signature}` rather
 * than trusting tronweb's in-place mutation, so what goes on the wire is
 * exactly the bytes whose hash we just verified, plus our signature.
 */
async function signAndBroadcast(
  endpoint: TronGridEndpoint,
  unsigned: UnsignedTransaction,
  privateKeyHex: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const signed = tronWebUtils.crypto.signTransaction(privateKeyHex, { txID: unsigned.txID })
  const signature = signed.signature
  if (!Array.isArray(signature) || signature.length === 0) {
    throw new PaymentConfigError('tronweb produced no signature for the sweep transaction')
  }

  const result = await postJson(
    endpoint,
    '/wallet/broadcasttransaction',
    { ...unsigned.raw, signature },
    fetchImpl
  )
  if (result.result !== true) {
    const code = typeof result.code === 'string' ? result.code : 'UNKNOWN'
    throw new PaymentProviderHttpError(
      `TronGrid rejected the broadcast (${code}): ${decodeNodeMessage(result.message)}`,
      200,
      result
    )
  }
  // The node echoes `txid`, but the authoritative id is the one we verified and
  // signed; a disagreement means we are not tracking the tx we actually sent.
  const echoed = typeof result.txid === 'string' ? result.txid.toLowerCase() : null
  if (echoed && echoed !== unsigned.txID.toLowerCase()) {
    throw new PaymentProviderHttpError(
      `TronGrid broadcast echoed txid ${echoed} but we signed ${unsigned.txID}`,
      200,
      result
    )
  }
  return unsigned.txID
}

// ── Public factory ─────────────────────────────────────────────────────────

/**
 * Builds the real, chain-facing signer. Wire the result into `sweep()`'s
 * `signAndBroadcast` / `sendTrx` dependencies in production; inject fakes in
 * tests.
 */
export function createTronGridSigner(endpoint: TronGridEndpoint, deps: TronSignerDeps = {}): TronSigner {
  const fetchImpl = deps.fetchImpl ?? fetch

  return {
    async signAndBroadcastTrc20(req: Trc20TransferRequest): Promise<string> {
      // fee_limit is a SUN-denominated ceiling on energy burnt. It must be at
      // least the call's real energy cost or the node reverts with
      // OUT_OF_ENERGY *after* consuming the fee, so it is configurable rather
      // than hardcoded — see TRON_SWEEP_FEE_LIMIT_SUN.
      const response = await postJson(
        endpoint,
        '/wallet/triggersmartcontract',
        {
          owner_address: tronAddressToHex(req.fromAddress),
          contract_address: tronAddressToHex(req.contractAddress),
          function_selector: TRC20_TRANSFER_SELECTOR,
          parameter: encodeTrc20TransferParameter(req.toAddress, req.amount),
          fee_limit: Number(req.feeLimitSun),
          call_value: 0,
          // visible:false => we send/receive hex21 addresses, not base58.
          visible: false
        },
        fetchImpl
      )

      const outcome = response.result
      const ok =
        typeof outcome === 'object' && outcome !== null && (outcome as { result?: unknown }).result === true
      if (!ok || typeof response.transaction !== 'object' || response.transaction === null) {
        const message =
          typeof outcome === 'object' && outcome !== null
            ? decodeNodeMessage((outcome as { message?: unknown }).message)
            : String(response.Error ?? '')
        throw new PaymentProviderHttpError(`TronGrid could not build the TRC-20 transfer: ${message}`, 200, response)
      }

      const unsigned = toUnsignedTransaction(
        response.transaction as Record<string, unknown>,
        'triggersmartcontract'
      )
      return signAndBroadcast(endpoint, unsigned, req.privateKeyHex, fetchImpl)
    },

    async sendTrx(req: TrxTransferRequest): Promise<string> {
      if (req.amountSun <= 0n) {
        throw new PaymentConfigError(`TRX transfer amount must be positive, got ${req.amountSun.toString()}`)
      }
      if (req.amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new PaymentConfigError('TRX top-up amount exceeds the safe integer range')
      }
      const response = await postJson(
        endpoint,
        '/wallet/createtransaction',
        {
          owner_address: tronAddressToHex(req.fromAddress),
          to_address: tronAddressToHex(req.toAddress),
          // The TRON HTTP API takes amounts as JSON numbers. The guard above
          // pins SUN values below Number.MAX_SAFE_INTEGER (9.007e15 sun ~=
          // 9 billion TRX), so this narrowing is lossless for any real top-up.
          amount: Number(req.amountSun),
          visible: false
        },
        fetchImpl
      )
      if (typeof response.Error === 'string') {
        throw new PaymentProviderHttpError(`TronGrid could not build the TRX transfer: ${response.Error}`, 200, response)
      }
      const unsigned = toUnsignedTransaction(response, 'createtransaction')
      return signAndBroadcast(endpoint, unsigned, req.privateKeyHex, fetchImpl)
    }
  }
}
