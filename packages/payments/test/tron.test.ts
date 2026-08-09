import { describe, it, expect, vi } from 'vitest'
import { HDKey } from '@scure/bip32'
import {
  createTronProvider,
  deriveAddress,
  classifyTransferAmount,
  isConfirmed,
  loadHotWalletPrivateKey,
  encryptHotWalletKey,
  type TronConfig,
  type OnChainTransfer,
  type TronProviderState
} from '../src/tron.js'

// Deterministic test master xpub, generated locally purely for this test
// (holds no funds; do not reuse anywhere real).
const TEST_SEED = new Uint8Array(32).fill(7)
const TEST_MASTER_XPUB = HDKey.fromMasterSeed(TEST_SEED).derive("m/44'/195'/0'").publicExtendedKey

const config: TronConfig = {
  masterXpub: TEST_MASTER_XPUB,
  tronGridApiKey: 'test-key',
  tronGridBaseUrl: 'https://api.trongrid.io',
  usdtContractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  minConfirmations: 19,
  treasuryAddress: 'TTreasuryAddressPlaceholder0000000'
}

describe('tron provider - address derivation', () => {
  it('derives a stable, valid-looking base58 TRON address for a given index', () => {
    const address = deriveAddress(config.masterXpub, 0)
    expect(address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{25,}$/)
    // Same index -> same address (deterministic).
    expect(deriveAddress(config.masterXpub, 0)).toBe(address)
  })

  it('derives different addresses for different indices', () => {
    const a0 = deriveAddress(config.masterXpub, 0)
    const a1 = deriveAddress(config.masterXpub, 1)
    expect(a0).not.toBe(a1)
  })
})

describe('tron provider - payment classification', () => {
  it('classifies exact, underpaid, and overpaid amounts', () => {
    expect(classifyTransferAmount(19_990_000n, 19_990_000n)).toBe('exact')
    expect(classifyTransferAmount(10_000_000n, 19_990_000n)).toBe('underpaid')
    expect(classifyTransferAmount(25_000_000n, 19_990_000n)).toBe('overpaid')
  })

  it('isConfirmed respects minConfirmations', () => {
    expect(isConfirmed(19, config)).toBe(true)
    expect(isConfirmed(18, config)).toBe(false)
  })
})

describe('tron provider - hot wallet key handling', () => {
  it('round-trips an encrypted keystore blob', () => {
    const encryptionKey = Buffer.alloc(32, 9)
    const rawKeyHex = 'aa'.repeat(32)
    const blob = encryptHotWalletKey(rawKeyHex, encryptionKey)
    expect(blob.startsWith('v1:')).toBe(true)
    const decrypted = loadHotWalletPrivateKey(blob, encryptionKey)
    expect(decrypted).toBe(rawKeyHex)
  })

  it('returns null (read-only mode) when no keystore is configured', () => {
    expect(loadHotWalletPrivateKey(undefined, undefined)).toBeNull()
  })
})

describe('tron provider - checkStatus (address-watching flow)', () => {
  function makeState(overrides: Partial<TronProviderState> = {}): TronProviderState {
    return {
      allocateDerivationIndex: vi.fn(async () => 0),
      saveDepositAddress: vi.fn(async () => undefined),
      lookupInvoiceState: vi.fn(async () => null),
      ...overrides
    }
  }

  it('returns pending when no transfer has arrived yet', async () => {
    const state = makeState({
      lookupInvoiceState: vi.fn(async () => ({ expectedAmount: '19990000', transfer: null }))
    })
    const provider = createTronProvider(config, state)
    const status = await provider.checkStatus('Taddress')
    expect(status).toBe('pending')
  })

  it('returns pending when transfer exists but is not yet confirmed enough', async () => {
    const transfer: OnChainTransfer = {
      txHash: 'tx1',
      toAddress: 'Taddress',
      fromAddress: 'Tsender',
      amount: '19990000',
      blockNumber: 100,
      confirmations: 3,
      timestamp: new Date()
    }
    const state = makeState({
      lookupInvoiceState: vi.fn(async () => ({ expectedAmount: '19990000', transfer }))
    })
    const provider = createTronProvider(config, state)
    const status = await provider.checkStatus('Taddress')
    expect(status).toBe('pending')
  })

  it('returns failed when confirmed but underpaid', async () => {
    const transfer: OnChainTransfer = {
      txHash: 'tx2',
      toAddress: 'Taddress',
      fromAddress: 'Tsender',
      amount: '10000000',
      blockNumber: 100,
      confirmations: 25,
      timestamp: new Date()
    }
    const state = makeState({
      lookupInvoiceState: vi.fn(async () => ({ expectedAmount: '19990000', transfer }))
    })
    const provider = createTronProvider(config, state)
    const status = await provider.checkStatus('Taddress')
    expect(status).toBe('failed')
  })

  it('returns paid when confirmed and amount matches or exceeds expected', async () => {
    const transfer: OnChainTransfer = {
      txHash: 'tx3',
      toAddress: 'Taddress',
      fromAddress: 'Tsender',
      amount: '19990000',
      blockNumber: 100,
      confirmations: 25,
      timestamp: new Date()
    }
    const state = makeState({
      lookupInvoiceState: vi.fn(async () => ({ expectedAmount: '19990000', transfer }))
    })
    const provider = createTronProvider(config, state)
    const status = await provider.checkStatus('Taddress')
    expect(status).toBe('paid')
  })

  it('returns failed (expiry-equivalent) when the invoice/address is unknown', async () => {
    const state = makeState({ lookupInvoiceState: vi.fn(async () => null) })
    const provider = createTronProvider(config, state)
    const status = await provider.checkStatus('unknown-address')
    expect(status).toBe('failed')
  })
})
