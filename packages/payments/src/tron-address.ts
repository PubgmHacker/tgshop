import { createHash } from 'node:crypto'
import { base58 } from '@scure/base'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { PaymentConfigError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// TRON address codec — shared by the HD-derivation path (tron.ts) and the
// transaction builder (tron-signer.ts). Kept in its own module so both can use
// it without an import cycle.
//
// A TRON address has three interchangeable representations:
//   • base58check  "T..."                    — what users/config/DB hold
//   • hex21        "41" + 20 bytes           — what the TRON HTTP API wants
//   • EVM word     20 bytes left-padded to 32 — what ABI-encoded args want
// The 0x41 version byte is what makes every mainnet address render as "T".
// ─────────────────────────────────────────────────────────────────────────────

/** TRON mainnet address version byte. */
export const TRON_ADDRESS_PREFIX = 0x41
/** version byte + 20-byte account id. */
const ADDRESS_PAYLOAD_BYTES = 21
const ADDRESS_CHECKSUM_BYTES = 4

/** Bitcoin-style double SHA-256, used for the base58check checksum. */
export function sha256d(data: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(data).digest()).digest()
}

/**
 * Keccak-256 (NOT NIST SHA3-256 — TRON/Ethereum use the original Keccak
 * padding). @noble/hashes exposes the pre-NIST variant explicitly as
 * `keccak_256`; using `sha3_256` here would produce wrong addresses.
 */
export function keccak256(data: Uint8Array): Buffer {
  return Buffer.from(keccak_256(data))
}

/**
 * Converts a secp256k1 public key (compressed or uncompressed) into a TRON
 * base58check address.
 *
 * TRON, like Ethereum, hashes the *uncompressed* 64-byte public key (X||Y with
 * no 0x04 prefix) with Keccak-256 and keeps the low 20 bytes. @scure/bip32's
 * HDKey only stores the compressed form, so we re-expand it through the
 * secp256k1 curve (@noble/curves, already a transitive dependency) first.
 */
export function publicKeyToTronAddress(publicKey: Uint8Array): string {
  const point = secp256k1.ProjectivePoint.fromHex(publicKey)
  const uncompressed = point.toRawBytes(false) // 0x04 || X(32) || Y(32)
  const xy = uncompressed.slice(1) // drop the 0x04 prefix -> 64 bytes

  const addressBytes20 = keccak256(xy).subarray(-20)
  const versioned = Buffer.concat([Buffer.from([TRON_ADDRESS_PREFIX]), addressBytes20])
  const checksum = sha256d(versioned).subarray(0, ADDRESS_CHECKSUM_BYTES)
  return base58.encode(Buffer.concat([versioned, checksum]))
}

/**
 * Decodes a base58check "T..." address into its 21-byte hex form (`41` +
 * 20-byte account id) as required by the TRON HTTP API.
 *
 * The base58check checksum is VERIFIED rather than trusted. This is the last
 * line of defence against a typo'd/truncated treasury address in config: an
 * unverified decode would happily produce a well-formed hex address that
 * nobody holds the key to, and the sweep would burn customer funds into a
 * black hole. A wrong checksum is caught here, before any signing happens.
 */
export function tronAddressToHex(address: string): string {
  let decoded: Uint8Array
  try {
    decoded = base58.decode(address)
  } catch {
    throw new PaymentConfigError(`Not a valid base58 TRON address: ${address}`)
  }
  if (decoded.length !== ADDRESS_PAYLOAD_BYTES + ADDRESS_CHECKSUM_BYTES) {
    throw new PaymentConfigError(
      `TRON address ${address} decodes to ${decoded.length} bytes, expected ${
        ADDRESS_PAYLOAD_BYTES + ADDRESS_CHECKSUM_BYTES
      }`
    )
  }
  const payload = Buffer.from(decoded.subarray(0, ADDRESS_PAYLOAD_BYTES))
  const checksum = Buffer.from(decoded.subarray(ADDRESS_PAYLOAD_BYTES))
  const expected = sha256d(payload).subarray(0, ADDRESS_CHECKSUM_BYTES)
  if (!checksum.equals(expected)) {
    throw new PaymentConfigError(`TRON address ${address} has an invalid base58check checksum`)
  }
  if (payload[0] !== TRON_ADDRESS_PREFIX) {
    throw new PaymentConfigError(
      `TRON address ${address} has version byte 0x${payload[0]?.toString(16)}, expected 0x41 (mainnet)`
    )
  }
  return payload.toString('hex')
}

/** True when `address` is a well-formed, checksum-valid TRON base58check address. */
export function isValidTronAddress(address: string): boolean {
  try {
    tronAddressToHex(address)
    return true
  } catch {
    return false
  }
}

/**
 * Derives the TRON base58check address controlled by a raw 32-byte hex private
 * key. Used to (a) find the hot wallet's own address from its key and (b)
 * prove that an xprv-derived key really controls the xpub-derived deposit
 * address before we sign anything with it.
 */
export function privateKeyToTronAddress(privateKeyHex: string): string {
  const normalized = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new PaymentConfigError('TRON private key must be 64 hex characters (32 bytes)')
  }
  // `true` => compressed public key; publicKeyToTronAddress re-expands it.
  return publicKeyToTronAddress(secp256k1.getPublicKey(Buffer.from(normalized, 'hex'), true))
}

