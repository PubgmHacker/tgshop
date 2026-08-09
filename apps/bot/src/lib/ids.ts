import { customAlphabet } from 'nanoid'

const nanoidSafe = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 21)

/** Generates a URL-safe idempotency / correlation key. */
export function newId(): string {
  return nanoidSafe()
}

/** Builds a deterministic idempotency key for a logical action + inputs, so retries collapse. */
export function idempotencyKey(scope: string, ...parts: (string | number)[]): string {
  return `${scope}:${parts.join(':')}`
}
