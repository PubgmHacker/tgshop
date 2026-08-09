import { prisma } from '@tgshop/db'
import { DeliveryFailedError, type ExternalSupplier } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL_API fulfilment adapter.
//
// core's deliver() owns the hard parts of external delivery — timeout, three
// attempts with backoff, a per-product circuit breaker, and fail-and-refund once
// the supplier is exhausted — but it deliberately does not know how to *call*
// anyone. It asks the caller for an ExternalSupplier instead. This is that
// supplier for the bot: an HTTP POST to the operator-configured
// `Product.externalConfig.deliveryUrl`, matching the contract apps/worker's
// delivery job already speaks.
//
// Without this, handing core no supplier would make every EXTERNAL_API purchase
// fail and auto-refund on the spot — a silent regression against the previous
// behaviour of routing those orders onward for fulfilment.
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

/** Narrows the supplier's JSON response to the single field core needs. */
function readPayload(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const { payload } = body as { payload?: unknown }
  return typeof payload === 'string' && payload !== '' ? payload : null
}

export const externalSupplier: ExternalSupplier = {
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

    // No timeout or retry here on purpose: core's deliver() wraps this call in
    // both, and duplicating them would multiply out to nine upstream requests.
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
