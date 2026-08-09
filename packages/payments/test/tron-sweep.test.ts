import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { HDKey } from '@scure/bip32'
import { LowTrxError, ManualSweepRequired, PaymentConfigError } from '../src/errors.js'
import {
  sweep,
  deriveAddress,
  deriveDepositPrivateKey,
  encryptHotWalletKey,
  loadMasterXprv,
  sumUnconfirmedInbound,
  type SweepDeps,
  type SweepLedger,
  type SweepRequest,
  type TronConfig
} from '../src/tron.js'
import {
  createTronGridSigner,
  encodeTrc20TransferParameter,
  TRC20_TRANSFER_SELECTOR
} from '../src/tron-signer.js'
import { privateKeyToTronAddress, tronAddressToHex } from '../src/tron-address.js'

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic test key material. Generated locally for this test only —
// holds no funds, never use anywhere real.
//
// Every chain interaction is injected (`fetchImpl` for the signer, explicit
// dependency callbacks for `sweep`). Nothing in this file touches the network.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_SEED = new Uint8Array(32).fill(7)
const TEST_ACCOUNT = HDKey.fromMasterSeed(TEST_SEED).derive("m/44'/195'/0'")
const TEST_MASTER_XPUB = TEST_ACCOUNT.publicExtendedKey
const TEST_MASTER_XPRV = TEST_ACCOUNT.privateExtendedKey

const ENCRYPTION_KEY = Buffer.alloc(32, 9)
const ENCRYPTED_XPRV = encryptHotWalletKey(TEST_MASTER_XPRV, ENCRYPTION_KEY)

const HOT_WALLET_KEY_HEX = '11'.repeat(32)
const ENCRYPTED_HOT_KEY = encryptHotWalletKey(HOT_WALLET_KEY_HEX, ENCRYPTION_KEY)
const HOT_WALLET_ADDRESS = privateKeyToTronAddress(HOT_WALLET_KEY_HEX)

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TREASURY_ADDRESS = deriveAddress(TEST_MASTER_XPUB, 9_999)
const DEPOSIT_INDEX = 3
const DEPOSIT_ADDRESS = deriveAddress(TEST_MASTER_XPUB, DEPOSIT_INDEX)

const config: TronConfig = {
  masterXpub: TEST_MASTER_XPUB,
  tronGridApiKey: 'test-key',
  tronGridBaseUrl: 'https://api.trongrid.io',
  usdtContractAddress: USDT_CONTRACT,
  minConfirmations: 19,
  treasuryAddress: TREASURY_ADDRESS
}

// ── Fake ledger: a faithful stand-in for the DepositAddress compare-and-swap ──

interface LedgerHarness {
  ledger: SweepLedger
  /** Ordered log of every ledger + chain side effect, for asserting sequencing. */
  calls: string[]
  claimed: Set<string>
  committed: Map<string, { txHash: string; amountSwept: bigint }>
}

function makeLedger(calls: string[] = []): LedgerHarness {
  const claimed = new Set<string>()
  const committed = new Map<string, { txHash: string; amountSwept: bigint }>()
  const ledger: SweepLedger = {
    async claim(address) {
      // Mirrors the worker's `UPDATE ... WHERE isSwept = false` CAS: the first
      // caller wins, everyone else is told no.
      if (claimed.has(address)) {
        calls.push('claim:denied')
        return false
      }
      claimed.add(address)
      calls.push('claim:granted')
      return true
    },
    async release(address) {
      claimed.delete(address)
      calls.push('release')
    },
    async commit(params) {
      committed.set(params.address, {
        txHash: params.txHash,
        amountSwept: params.amountSwept
      })
      calls.push('commit')
    }
  }
  return { ledger, calls, claimed, committed }
}

interface SweepScenario {
  usdtBalance?: bigint
  unconfirmedInbound?: bigint
  /** Successive TRX balances per address; the last value repeats. */
  trxBalances?: Record<string, bigint[]>
  broadcastImpl?: () => Promise<string>
}

function makeDeps(scenario: SweepScenario, harness: LedgerHarness): SweepDeps {
  const trxCallCounts = new Map<string, number>()
  const signAndBroadcast = vi.fn(async () => {
    harness.calls.push('broadcast')
    if (scenario.broadcastImpl) return scenario.broadcastImpl()
    return 'sweep-tx-hash'
  })
  const sendTrx = vi.fn(async () => {
    harness.calls.push('topup')
    return 'topup-tx-hash'
  })

  return {
    encryptionKey: ENCRYPTION_KEY,
    sleep: async () => undefined,
    ledger: harness.ledger,
    getUsdtBalance: vi.fn(async () => scenario.usdtBalance ?? 10_000_000n),
    getUnconfirmedInboundUsdt: vi.fn(async () => scenario.unconfirmedInbound ?? 0n),
    getTrxBalanceSun: vi.fn(async (address: string) => {
      const series = scenario.trxBalances?.[address] ?? [100_000_000n]
      const seen = trxCallCounts.get(address) ?? 0
      trxCallCounts.set(address, seen + 1)
      return series[Math.min(seen, series.length - 1)] ?? 0n
    }),
    signAndBroadcast,
    sendTrx
  }
}

function makeRequest(overrides: Partial<SweepRequest> = {}): SweepRequest {
  return {
    derivationIndex: DEPOSIT_INDEX,
    toAddress: TREASURY_ADDRESS,
    encryptedMasterXprv: ENCRYPTED_XPRV,
    encryptedHotWalletKey: ENCRYPTED_HOT_KEY,
    readOnly: false,
    thresholdUsdt6: 1_000_000n,
    ...overrides
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TRC-20 transfer payload construction', () => {
  it('ABI-encodes transfer(address,uint256) arguments exactly', () => {
    // USDT contract address as recipient; its 21-byte hex form is
    // 41a614f803b6fd780986a42c78ec9c7f77e6ded13c. The 0x41 version byte must be
    // stripped and the remaining 20 bytes left-padded to a 32-byte word.
    const encoded = encodeTrc20TransferParameter(USDT_CONTRACT, 1_500_000n)
    expect(encoded).toBe(
      '000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c' +
        '000000000000000000000000000000000000000000000000000000000016e360'
    )
    expect(encoded).toHaveLength(128)
  })

  it('rejects a non-positive amount and a bad-checksum address', () => {
    expect(() => encodeTrc20TransferParameter(USDT_CONTRACT, 0n)).toThrow(PaymentConfigError)
    // Flip one character of a valid address: base58 still decodes, checksum fails.
    const corrupted = `${USDT_CONTRACT.slice(0, -1)}${USDT_CONTRACT.endsWith('t') ? 'u' : 't'}`
    expect(() => encodeTrc20TransferParameter(corrupted, 1n)).toThrow(/checksum/)
  })

  it('builds, signs and broadcasts the correct triggersmartcontract payload', async () => {
    const rawDataHex = '0a02b1f42208'
    const txID = createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest('hex')
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = []

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push({ url: String(url), body })
      if (String(url).endsWith('/wallet/triggersmartcontract')) {
        return new Response(
          JSON.stringify({
            result: { result: true },
            transaction: { visible: false, txID, raw_data: {}, raw_data_hex: rawDataHex }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ result: true, txid: txID }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as unknown as typeof fetch

    const signer = createTronGridSigner(config, { fetchImpl })
    const hash = await signer.signAndBroadcastTrc20({
      fromAddress: DEPOSIT_ADDRESS,
      privateKeyHex: deriveDepositPrivateKey(TEST_MASTER_XPRV, DEPOSIT_INDEX),
      toAddress: TREASURY_ADDRESS,
      amount: 7_250_000n,
      contractAddress: USDT_CONTRACT,
      feeLimitSun: 40_000_000n
    })

    expect(hash).toBe(txID)
    expect(bodies).toHaveLength(2)

    const build = bodies[0]
    expect(build?.url).toBe('https://api.trongrid.io/wallet/triggersmartcontract')
    expect(build?.body).toMatchObject({
      owner_address: tronAddressToHex(DEPOSIT_ADDRESS),
      contract_address: tronAddressToHex(USDT_CONTRACT),
      function_selector: TRC20_TRANSFER_SELECTOR,
      parameter: encodeTrc20TransferParameter(TREASURY_ADDRESS, 7_250_000n),
      fee_limit: 40_000_000,
      call_value: 0,
      visible: false
    })

    const broadcast = bodies[1]
    expect(broadcast?.url).toBe('https://api.trongrid.io/wallet/broadcasttransaction')
    expect(broadcast?.body.txID).toBe(txID)
    expect(broadcast?.body.raw_data_hex).toBe(rawDataHex)
    // 65-byte recoverable secp256k1 signature: r(32) || s(32) || v(1).
    // tronweb renders the trailing recovery byte in uppercase, hence [0-9a-fA-F].
    const signature = broadcast?.body.signature as string[]
    expect(signature).toHaveLength(1)
    expect(signature[0]).toMatch(/^[0-9a-fA-F]{130}$/)
  })

  it('refuses to sign when the node returns a txID that is not sha256(raw_data)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: { result: true },
            transaction: { visible: false, txID: 'ab'.repeat(32), raw_data: {}, raw_data_hex: '0a02b1f4' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch

    const signer = createTronGridSigner(config, { fetchImpl })
    await expect(
      signer.signAndBroadcastTrc20({
        fromAddress: DEPOSIT_ADDRESS,
        privateKeyHex: deriveDepositPrivateKey(TEST_MASTER_XPRV, DEPOSIT_INDEX),
        toAddress: TREASURY_ADDRESS,
        amount: 1_000_000n,
        contractAddress: USDT_CONTRACT,
        feeLimitSun: 40_000_000n
      })
    ).rejects.toThrow(/Refusing to sign/)
  })
})

describe('per-address key derivation', () => {
  it('derives a private key whose address matches the xpub-derived deposit address', () => {
    const privateKeyHex = deriveDepositPrivateKey(TEST_MASTER_XPRV, DEPOSIT_INDEX)
    expect(privateKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(privateKeyToTronAddress(privateKeyHex)).toBe(DEPOSIT_ADDRESS)
  })

  it('explains itself when handed an xpub instead of an xprv', () => {
    expect(() => deriveDepositPrivateKey(TEST_MASTER_XPUB, 0)).toThrow(/PUBLIC extended key/)
  })

  it('round-trips an encrypted xprv keystore and returns null when unset', () => {
    expect(loadMasterXprv(ENCRYPTED_XPRV, ENCRYPTION_KEY)).toBe(TEST_MASTER_XPRV)
    expect(loadMasterXprv(undefined, ENCRYPTION_KEY)).toBeNull()
  })
})

describe('sweep - read-only mode', () => {
  it('throws ManualSweepRequired when TRON_SWEEP_READ_ONLY is on, even with keys present', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 50_000_000n }, harness)

    await expect(sweep(config, makeRequest({ readOnly: true }), deps)).rejects.toBeInstanceOf(
      ManualSweepRequired
    )
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
    expect(harness.calls).not.toContain('claim:granted')
  })

  it('throws ManualSweepRequired when no xprv is configured', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 50_000_000n }, harness)

    const error = await sweep(config, makeRequest({ encryptedMasterXprv: undefined }), deps).catch(
      (err: unknown) => err
    )
    expect(error).toBeInstanceOf(ManualSweepRequired)
    expect((error as ManualSweepRequired).address).toBe(DEPOSIT_ADDRESS)
    expect((error as ManualSweepRequired).balance).toBe(50_000_000n)
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
  })
})

describe('sweep - energy funding', () => {
  it('tops the deposit address up from the hot wallet, then sweeps', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      {
        usdtBalance: 25_000_000n,
        trxBalances: {
          // Empty, still empty right after the top-up, then funded.
          [DEPOSIT_ADDRESS]: [0n, 0n, 30_000_000n],
          [HOT_WALLET_ADDRESS]: [500_000_000n]
        }
      },
      harness
    )

    const outcome = await sweep(config, makeRequest(), deps)

    expect(outcome.status).toBe('swept')
    expect(deps.sendTrx).toHaveBeenCalledWith({
      fromAddress: HOT_WALLET_ADDRESS,
      privateKeyHex: HOT_WALLET_KEY_HEX,
      toAddress: DEPOSIT_ADDRESS,
      amountSun: 30_000_000n
    })
    // Top-up must land before the TRC-20 transfer is broadcast.
    expect(harness.calls).toEqual(['claim:granted', 'topup', 'broadcast', 'commit'])
  })

  it('skips the top-up entirely when the deposit address already holds enough TRX', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      { usdtBalance: 25_000_000n, trxBalances: { [DEPOSIT_ADDRESS]: [40_000_000n] } },
      harness
    )

    await sweep(config, makeRequest(), deps)
    expect(deps.sendTrx).not.toHaveBeenCalled()
    expect(harness.calls).toEqual(['claim:granted', 'broadcast', 'commit'])
  })

  it('raises LowTrxError and broadcasts nothing when the hot wallet cannot fund energy', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      {
        usdtBalance: 25_000_000n,
        trxBalances: {
          [DEPOSIT_ADDRESS]: [0n],
          // Below topUpSun (30 TRX) + hotWalletFloorSun (50 TRX).
          [HOT_WALLET_ADDRESS]: [40_000_000n]
        }
      },
      harness
    )

    const error = await sweep(config, makeRequest(), deps).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(LowTrxError)
    expect((error as LowTrxError).address).toBe(HOT_WALLET_ADDRESS)
    expect((error as LowTrxError).requiredSunEstimate).toBe(40_000_000n)

    expect(deps.sendTrx).not.toHaveBeenCalled()
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
    // The claim is surrendered so a later run can retry once TRX is topped up.
    expect(harness.calls).toEqual(['claim:granted', 'release'])
    expect(harness.claimed.size).toBe(0)
  })

  it('raises LowTrxError when no hot wallet key is configured at all', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      { usdtBalance: 25_000_000n, trxBalances: { [DEPOSIT_ADDRESS]: [0n] } },
      harness
    )

    await expect(
      sweep(config, makeRequest({ encryptedHotWalletKey: undefined }), deps)
    ).rejects.toBeInstanceOf(LowTrxError)
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
  })

  it('raises LowTrxError when a top-up never lands before the timeout', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      {
        usdtBalance: 25_000_000n,
        trxBalances: { [DEPOSIT_ADDRESS]: [0n], [HOT_WALLET_ADDRESS]: [500_000_000n] }
      },
      harness
    )
    // Clock jumps past the timeout on the second reading.
    let tick = 0
    deps.now = () => new Date(tick++ * 60_000)

    await expect(sweep(config, makeRequest(), deps)).rejects.toBeInstanceOf(LowTrxError)
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
  })
})

describe('sweep - settlement bookkeeping', () => {
  it('commits (isSwept) only after the broadcast succeeds', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 25_000_000n }, harness)

    const outcome = await sweep(config, makeRequest(), deps)

    expect(outcome).toMatchObject({ status: 'swept', txHash: 'sweep-tx-hash', amountSwept: '25000000' })
    // Ordering is the point: nothing is marked swept before the chain accepted it.
    expect(harness.calls.indexOf('broadcast')).toBeLessThan(harness.calls.indexOf('commit'))
    expect(harness.committed.get(DEPOSIT_ADDRESS)).toEqual({
      txHash: 'sweep-tx-hash',
      amountSwept: 25_000_000n
    })
  })

  it('never commits when the broadcast fails, and keeps the claim held', async () => {
    const harness = makeLedger()
    const deps = makeDeps(
      {
        usdtBalance: 25_000_000n,
        broadcastImpl: async () => {
          throw new Error('TronGrid rejected the broadcast (SIGERROR)')
        }
      },
      harness
    )

    await expect(sweep(config, makeRequest(), deps)).rejects.toThrow(/SIGERROR/)

    expect(harness.committed.size).toBe(0)
    expect(harness.calls).toEqual(['claim:granted', 'broadcast'])
    // A broadcast that threw may still have reached the network, so the claim is
    // intentionally NOT released — stranded funds beat a double-spend.
    expect(harness.claimed.has(DEPOSIT_ADDRESS)).toBe(true)
    expect(harness.calls).not.toContain('release')
  })

  it('releases the claim when the failure happened before any broadcast', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 25_000_000n }, harness)
    // An xprv from a different seed: the identity check must fail pre-broadcast.
    const foreignXprv = HDKey.fromMasterSeed(new Uint8Array(32).fill(1))
      .derive("m/44'/195'/0'")
      .privateExtendedKey

    await expect(
      sweep(
        config,
        makeRequest({ encryptedMasterXprv: encryptHotWalletKey(foreignXprv, ENCRYPTION_KEY) }),
        deps
      )
    ).rejects.toThrow(/does not match TRON_MASTER_XPUB/)

    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
    expect(harness.calls).toEqual(['claim:granted', 'release'])
    expect(harness.claimed.size).toBe(0)
  })

  it('refuses to sweep when the database address disagrees with the xpub', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 25_000_000n }, harness)

    await expect(
      sweep(config, makeRequest({ expectedAddress: TREASURY_ADDRESS }), deps)
    ).rejects.toThrow(/Deposit address mismatch/)
    expect(harness.calls).toEqual([])
  })

  it('rejects a bad-checksum treasury address before taking a claim', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 25_000_000n }, harness)
    const corrupted = `${TREASURY_ADDRESS.slice(0, -1)}${TREASURY_ADDRESS.endsWith('t') ? 'u' : 't'}`

    await expect(sweep(config, makeRequest({ toAddress: corrupted }), deps)).rejects.toThrow(/checksum/)
    // No claim taken => a config fix does not require unsticking every row.
    expect(harness.calls).toEqual([])
    expect(harness.claimed.size).toBe(0)
  })
})

describe('sweep - double-sweep protection', () => {
  it('lets exactly one of two concurrent sweeps broadcast', async () => {
    const harness = makeLedger()
    const depsA = makeDeps({ usdtBalance: 25_000_000n }, harness)
    const depsB = makeDeps({ usdtBalance: 25_000_000n }, harness)

    const [a, b] = await Promise.all([
      sweep(config, makeRequest(), depsA),
      sweep(config, makeRequest(), depsB)
    ])

    const outcomes = [a.status, b.status].sort()
    expect(outcomes).toEqual(['skipped', 'swept'])
    const skipped = a.status === 'skipped' ? a : b.status === 'skipped' ? b : null
    expect(skipped?.status === 'skipped' && skipped.reason).toBe('already_claimed')

    const broadcasts = harness.calls.filter((c) => c === 'broadcast')
    expect(broadcasts).toHaveLength(1)
    expect(harness.committed.size).toBe(1)
  })

  it('does not re-sweep an address whose claim is already held', async () => {
    const harness = makeLedger()
    harness.claimed.add(DEPOSIT_ADDRESS)
    const deps = makeDeps({ usdtBalance: 25_000_000n }, harness)

    const outcome = await sweep(config, makeRequest(), deps)

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'already_claimed' })
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
  })
})

describe('sweep - amount safety', () => {
  it('waits instead of sweeping while any deposit is still unconfirmed', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 30_000_000n, unconfirmedInbound: 12_000_000n }, harness)

    const outcome = await sweep(config, makeRequest(), deps)

    // All-or-nothing: moving only the confirmed 18 USDT would force us to
    // re-open the address and risk a duplicate transfer next round.
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'unconfirmed_pending' })
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
    expect(deps.sendTrx).not.toHaveBeenCalled()
    expect(harness.calls).toEqual([])
  })

  it('sweeps the whole balance once every deposit has confirmed', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 30_000_000n, unconfirmedInbound: 0n }, harness)

    const outcome = await sweep(config, makeRequest(), deps)

    expect(outcome).toMatchObject({ status: 'swept', amountSwept: '30000000' })
    expect(deps.signAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30_000_000n, toAddress: TREASURY_ADDRESS })
    )
  })

  it('skips below-threshold balances without paying for energy', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 400_000n }, harness)

    const outcome = await sweep(config, makeRequest({ thresholdUsdt6: 1_000_000n }), deps)

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'below_threshold', sweepableAmount: '400000' })
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
    expect(deps.sendTrx).not.toHaveBeenCalled()
  })

  it('never broadcasts a zero-amount transfer for an empty address', async () => {
    const harness = makeLedger()
    const deps = makeDeps({ usdtBalance: 0n }, harness)

    const outcome = await sweep(config, makeRequest({ thresholdUsdt6: 0n }), deps)

    expect(outcome).toMatchObject({ status: 'skipped', sweepableAmount: '0' })
    expect(deps.signAndBroadcast).not.toHaveBeenCalled()
  })

  it('sums unconfirmed inbound transfers by block age', () => {
    const now = 1_000_000_000_000
    const transfers = [
      { amount: 5_000_000n, blockTimestampMs: now - 10_000 }, // ~3 blocks: unconfirmed
      { amount: 7_000_000n, blockTimestampMs: now - 200_000 } // ~66 blocks: confirmed
    ]
    expect(sumUnconfirmedInbound(transfers, now, 19)).toBe(5_000_000n)
    expect(sumUnconfirmedInbound(transfers, now, 0)).toBe(0n)
  })
})
