import type { PrismaClient } from '@tgshop/db'
import { DeliveryFailedError } from './errors.js'
import type { ExternalSupplier } from './delivery.js'

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL_API fulfilment over HTTP.
//
// deliver() owns the hard parts of external delivery — timeout, three attempts
// with backoff, a per-product circuit breaker, and fail-and-refund once the
// supplier is exhausted — but deliberately does not know how to *call* anyone.
// It asks the caller for an ExternalSupplier. This is that supplier: a POST to
// the operator-configured `Product.externalConfig.deliveryUrl`.
//
// It lives in core rather than in each app because every app that settles an
// order needs it, and the previous arrangement — one copy in apps/bot, another
// in apps/worker — is precisely how the two delivery paths drifted apart.
// Outbound fetch is the one piece of I/O here that is not Prisma; it is kept
// behind the ExternalSupplier interface so tests inject their own.
//
// externalConfig is operator-entered JSON with no schema behind it, so it is
// read defensively and a malformed value becomes a normal delivery failure
// (retried, then refunded) rather than a crash.
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedEndpoint {
  url: string
  headers: Record<string, string>
}

function readEndpoint(externalConfig: unknown): ResolvedEndpoint | null {
  if (typeof externalConfig !== 'object' || externalConfig === null || Array.isArray(externalConfig)) {
    return null
  }

  const { deliveryUrl, headers } = externalConfig as { deliveryUrl?: unknown; headers?: unknown }
  if (typeof deliveryUrl !== 'string' || deliveryUrl.trim() === '') return null

  const resolvedHeaders: Record<string, string> = {}
  if (typeof headers === 'object' && headers !== null && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') resolvedHeaders[key] = value
    }
  }

  return { url: deliveryUrl, headers: resolvedHeaders }
}

/** Narrows the supplier's JSON response to the single field delivery needs. */
function readPayload(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const { payload } = body as { payload?: unknown }
  return typeof payload === 'string' && payload !== '' ? payload : null
}

/**
 * Builds the HTTP ExternalSupplier for a given Prisma client.
 *
 * No timeout or retry here on purpose: deliver() wraps every call in both, and
 * duplicating them would multiply out to nine upstream requests per order.
 */
export function createHttpExternalSupplier(prisma: PrismaClient): ExternalSupplier {
  return {
    async fulfill({ orderId, planId, qty }): Promise<{ payload: string }> {
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        select: { product: { select: { externalConfig: true } } }
      })

      const endpoint = readEndpoint(plan?.product.externalConfig)
      if (!endpoint) {
        throw new DeliveryFailedError(
          orderId,
          `plan ${planId} is EXTERNAL_API but its product has no externalConfig.deliveryUrl`
        )
      }

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...endpoint.headers },
        body: JSON.stringify({ orderId, planId, qty })
      })

      if (!res.ok) {
        throw new DeliveryFailedError(orderId, `external delivery API returned HTTP ${res.status}`)
      }

      const payload = readPayload(await res.json())
      if (payload === null) {
        throw new DeliveryFailedError(orderId, 'external delivery API returned no payload')
      }

      return { payload }
    }
  }
}
