import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { CryptoError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM encrypt/decrypt — MUST stay byte-identical to the ciphertext
// format used by the database and admin stock flows.
//
// Format: v1:<ivB64>:<tagB64>:<ctB64>
//   v1     literal version prefix, allows future format migrations
//   ivB64  12-byte random IV, base64
//   tagB64 16-byte GCM auth tag, base64
//   ctB64  ciphertext, base64
//
// ENCRYPTION_KEY env var: raw 32-byte AES-256 key, accepted as either a
// 64-char hex string or a base64 string decoding to exactly 32 bytes.
// ─────────────────────────────────────────────────────────────────────────────

const CIPHER_ALGO = 'aes-256-gcm'
const CIPHER_VERSION = 'v1'
const IV_LENGTH = 12
const TAG_LENGTH = 16

export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.ENCRYPTION_KEY
  if (!raw) {
    throw new CryptoError('ENCRYPTION_KEY is not set')
  }
  const hexPattern = /^[0-9a-fA-F]{64}$/
  if (hexPattern.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new CryptoError(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}); expected 64-char hex or base64`
    )
  }
  return buf
}

/**
 * Encrypts plaintext with AES-256-GCM, producing the `v1:<iv>:<tag>:<ct>` format.
 * `key` defaults to the key loaded from ENCRYPTION_KEY when omitted.
 */
export function encrypt(plaintext: string, key?: Buffer): string {
  const cryptoKey = key ?? loadEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(CIPHER_ALGO, cryptoKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${CIPHER_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString(
    'base64'
  )}`
}

/**
 * Decrypts a `v1:<iv>:<tag>:<ct>` payload. Throws CryptoError on any tamper,
 * malformed input, or auth-tag mismatch.
 */
export function decrypt(payload: string, key?: Buffer): string {
  const cryptoKey = key ?? loadEncryptionKey()
  const parts = payload.split(':')
  if (parts.length !== 4) {
    throw new CryptoError('Malformed ciphertext payload: expected 4 colon-separated parts')
  }
  const [version, ivB64, tagB64, ctB64] = parts
  if (version !== CIPHER_VERSION) {
    throw new CryptoError(`Unsupported ciphertext version: ${String(version)}`)
  }
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new CryptoError('Malformed ciphertext payload: missing component')
  }

  let iv: Buffer
  let tag: Buffer
  let ciphertext: Buffer
  try {
    iv = Buffer.from(ivB64, 'base64')
    tag = Buffer.from(tagB64, 'base64')
    ciphertext = Buffer.from(ctB64, 'base64')
  } catch {
    throw new CryptoError('Malformed ciphertext payload: invalid base64')
  }

  if (iv.length !== IV_LENGTH) {
    throw new CryptoError(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`)
  }
  if (tag.length !== TAG_LENGTH) {
    throw new CryptoError(`Invalid auth tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`)
  }

  try {
    const decipher = createDecipheriv(CIPHER_ALGO, cryptoKey, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    // GCM auth tag mismatch or any other decrypt failure — treat uniformly as tamper.
    throw new CryptoError('Decryption failed: ciphertext or auth tag is invalid (possible tamper)')
  }
}

/** Constant-time comparison helper, exposed for callers that need it (e.g. webhook signatures). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
