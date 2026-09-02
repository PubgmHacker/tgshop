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

export class StalePriceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StalePriceError'
  }
}
