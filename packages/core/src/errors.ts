// ─────────────────────────────────────────────────────────────────────────────
// Typed domain errors for @tgshop/core
// ─────────────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class CryptoError extends DomainError {
  constructor(message: string) {
    super('CRYPTO_ERROR', message)
    this.name = 'CryptoError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class OrderStateError extends DomainError {
  public readonly from: string
  public readonly to: string

  constructor(from: string, to: string) {
    super('ORDER_STATE_ERROR', `Illegal order transition: ${from} -> ${to}`)
    this.name = 'OrderStateError'
    this.from = from
    this.to = to
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(userId: string, requiredCents: number, availableCents: number) {
    super(
      'INSUFFICIENT_BALANCE',
      `User ${userId} has insufficient balance: required ${requiredCents}, available ${availableCents}`
    )
    this.name = 'InsufficientBalanceError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(key: string) {
    super('IDEMPOTENCY_CONFLICT', `Idempotency key already used with a different payload: ${key}`)
    this.name = 'IdempotencyConflictError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class PromoInvalidError extends DomainError {
  constructor(reason: string) {
    super('PROMO_INVALID', `Promo code invalid: ${reason}`)
    this.name = 'PromoInvalidError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class StockUnavailableError extends DomainError {
  constructor(planId: string) {
    super('STOCK_UNAVAILABLE', `No available stock for plan ${planId}`)
    this.name = 'StockUnavailableError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class DeliveryFailedError extends DomainError {
  constructor(orderId: string, reason: string) {
    super('DELIVERY_FAILED', `Delivery failed for order ${orderId}: ${reason}`)
    this.name = 'DeliveryFailedError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ReferralError extends DomainError {
  constructor(reason: string) {
    super('REFERRAL_ERROR', reason)
    this.name = 'ReferralError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class SettingsValidationError extends DomainError {
  constructor(key: string, reason: string) {
    super('SETTINGS_VALIDATION_ERROR', `Setting "${key}" failed validation: ${reason}`)
    this.name = 'SettingsValidationError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class OrderNotFoundError extends DomainError {
  public readonly orderId: string

  constructor(orderId: string) {
    super('ORDER_NOT_FOUND', `Order ${orderId} not found`)
    this.name = 'OrderNotFoundError'
    this.orderId = orderId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown by delivery for MANUAL_FALLBACK products. NOT a failure: the order is
 * deliberately left in DELIVERING and a human admin completes it out of band.
 * Callers must catch this specifically and raise an admin alert rather than
 * treating it like DeliveryFailedError (which refunds).
 */
export class ManualFallbackRequiredError extends DomainError {
  public readonly orderId: string

  constructor(orderId: string) {
    super('MANUAL_FALLBACK_REQUIRED', `Order ${orderId} requires manual delivery by an admin`)
    this.name = 'ManualFallbackRequiredError'
    this.orderId = orderId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
