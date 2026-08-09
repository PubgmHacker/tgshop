// Shared error types for @tgshop/payments.

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentConfigError'
  }
}

export class PaymentProviderHttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'PaymentProviderHttpError'
    this.status = status
    this.body = body
  }
}

/** Thrown by tron.ts `sweep()` when the hot wallet lacks enough TRX for energy/bandwidth. */
export class LowTrxError extends Error {
  readonly address: string
  readonly requiredSunEstimate: bigint

  constructor(address: string, requiredSunEstimate: bigint) {
    super(
      `Insufficient TRX for energy/bandwidth to sweep from ${address}: need ~${requiredSunEstimate.toString()} sun`
    )
    this.name = 'LowTrxError'
    this.address = address
    this.requiredSunEstimate = requiredSunEstimate
  }
}

/**
 * Thrown by tron.ts `sweep()` when TRON_HOT_WALLET_KEY is not configured
 * (read-only mode). Sweeping requires manual operator action in this mode.
 */
export class ManualSweepRequired extends Error {
  readonly address: string
  readonly balance: bigint

  constructor(address: string, balance: bigint) {
    super(
      `Hot wallet key not configured (read-only mode); manual sweep required for ${address} (balance ${balance.toString()})`
    )
    this.name = 'ManualSweepRequired'
    this.address = address
    this.balance = balance
  }
}

export class StalePriceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StalePriceError'
  }
}
