import type { FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import {
  DeliveryFailedError,
  InsufficientBalanceError,
  OrderNotFoundError,
  OrderStateError,
  PromoInvalidError,
  StockUnavailableError
} from '@tgshop/core'
import { t, type Locale } from '../i18n/index.js'
import { logger } from './logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Uniform API error envelope.
//
// The Mini App's apiClient reads `{ error: { code, message } }` (see
// apps/miniapp/src/types/api.ts → ApiErrorSchema), so every /api/* failure MUST
// use this shape. Messages are localized through the shared i18n helper.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  error: { code: string; message: string }
}

export class HttpError extends Error {
  public readonly statusCode: number
  public readonly code: string
  /** i18n dot-path used to render a user-facing message. */
  public readonly messageKey: string
  public readonly messageVars: Record<string, string | number>

  constructor(
    statusCode: number,
    code: string,
    messageKey: string,
    messageVars: Record<string, string | number> = {}
  ) {
    super(`${code}: ${messageKey}`)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.messageKey = messageKey
    this.messageVars = messageVars
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export const badRequest = (key: string, vars?: Record<string, string | number>): HttpError =>
  new HttpError(400, 'BAD_REQUEST', key, vars)

export const notFound = (key = 'api.errors.not_found'): HttpError => new HttpError(404, 'NOT_FOUND', key)

export const forbidden = (key = 'api.errors.forbidden'): HttpError => new HttpError(403, 'FORBIDDEN', key)

/** Builds the wire body for an error, localized for the caller. */
export function toApiErrorBody(code: string, locale: Locale, messageKey: string, vars: Record<string, string | number> = {}): ApiErrorBody {
  return { error: { code, message: t(locale, messageKey, vars) } }
}

/**
 * Maps any thrown value onto an HTTP status + localized error envelope.
 * Domain errors from @tgshop/core carry their own stable `code`, which the
 * Mini App can branch on; anything unrecognized degrades to a 500 with a
 * generic message so internal details never leak to the client.
 */
export function describeError(err: unknown, locale: Locale): { status: number; body: ApiErrorBody } {
  if (err instanceof HttpError) {
    return { status: err.statusCode, body: toApiErrorBody(err.code, locale, err.messageKey, err.messageVars) }
  }

  if (err instanceof ZodError) {
    return { status: 400, body: toApiErrorBody('VALIDATION_ERROR', locale, 'api.errors.validation') }
  }

  if (err instanceof InsufficientBalanceError) {
    return { status: 402, body: toApiErrorBody(err.code, locale, 'api.errors.insufficient_balance') }
  }

  if (err instanceof StockUnavailableError) {
    return { status: 409, body: toApiErrorBody(err.code, locale, 'api.errors.stock_unavailable') }
  }

  if (err instanceof PromoInvalidError) {
    return { status: 400, body: toApiErrorBody(err.code, locale, 'api.errors.promo_invalid') }
  }

  if (err instanceof OrderStateError) {
    return { status: 409, body: toApiErrorBody(err.code, locale, 'api.errors.order_state') }
  }

  // core's order mutators throw this for an id that does not exist; without the
  // mapping it would degrade to a 500 and read as an outage rather than a typo.
  if (err instanceof OrderNotFoundError) {
    return { status: 404, body: toApiErrorBody(err.code, locale, 'api.errors.order_not_found') }
  }

  if (err instanceof DeliveryFailedError) {
    return { status: 500, body: toApiErrorBody(err.code, locale, 'api.errors.delivery_failed') }
  }

  return { status: 500, body: toApiErrorBody('INTERNAL_ERROR', locale, 'api.errors.internal') }
}

/** Sends a mapped error response, logging 5xx causes with full context. */
export async function sendError(reply: FastifyReply, err: unknown, locale: Locale): Promise<void> {
  const { status, body } = describeError(err, locale)
  if (status >= 500) {
    logger.error({ err, url: reply.request.url }, 'api request failed')
  } else {
    logger.debug({ err, url: reply.request.url, status }, 'api request rejected')
  }
  await reply.code(status).send(body)
}
