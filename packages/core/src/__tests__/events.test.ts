import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import {
  EVENT_SCHEMA_VERSION,
  consumeEvents,
  ensureConsumerGroups,
  publishEvent,
  streamKeyFor,
  type EventName
} from '../events.js'

// ─────────────────────────────────────────────────────────────────────────────
// The event bus is the Phase-2 agent seam (docs/AGENT_PLAN.md): external
// consumers build against the stream names and wire format pinned here, so a
// drift in either is a breaking change this file exists to catch.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_STREAMS: Record<EventName, string> = {
  'order.paid': 'tgshop:events:orders',
  'order.delivered': 'tgshop:events:orders',
  'order.failed': 'tgshop:events:orders',
  'order.refunded': 'tgshop:events:orders',
  'stock.low': 'tgshop:events:stock',
  'stock.depleted': 'tgshop:events:stock',
  'payment.received': 'tgshop:events:payments',
  'payment.underpaid': 'tgshop:events:payments',
  'payment.reconcile_mismatch': 'tgshop:events:payments',
  'user.registered': 'tgshop:events:users',
  'subscription.expiring_soon': 'tgshop:events:subs',
  'broadcast.sent': 'tgshop:events:broadcasts'
}

describe('streamKeyFor', () => {
  it.each(Object.entries(EXPECTED_STREAMS))('routes %s to %s', (event, stream) => {
    expect(streamKeyFor(event as EventName)).toBe(stream)
  })
})

describe('publishEvent', () => {
  it('writes the pinned wire format: type, schemaVersion, emittedAt, data', async () => {
    const xadd = vi.fn().mockResolvedValue('1-1')
    const redis = { xadd } as unknown as Redis

    const id = await publishEvent(redis, 'stock.depleted', {
      planId: 'plan_1',
      productId: 'prod_1'
    })

    expect(id).toBe('1-1')
    expect(xadd).toHaveBeenCalledTimes(1)

    const args = xadd.mock.calls[0] as unknown[]
    expect(args[0]).toBe('tgshop:events:stock')
    expect(args[1]).toBe('*')

    // Field/value pairs after the stream key and id.
    const fields = new Map<string, string>()
    for (let i = 2; i + 1 < args.length; i += 2) {
      fields.set(args[i] as string, args[i + 1] as string)
    }
    expect(fields.get('type')).toBe('stock.depleted')
    expect(fields.get('schemaVersion')).toBe(EVENT_SCHEMA_VERSION)
    expect(() => new Date(fields.get('emittedAt') as string).toISOString()).not.toThrow()
    expect(JSON.parse(fields.get('data') as string)).toEqual({
      planId: 'plan_1',
      productId: 'prod_1'
    })
  })

  it('throws when XADD returns no entry id, so a silent drop cannot look like success', async () => {
    const redis = { xadd: vi.fn().mockResolvedValue(null) } as unknown as Redis
    await expect(
      publishEvent(redis, 'broadcast.sent', {
        postId: 'post_1',
        total: 10,
        sent: 9,
        blocked: 1,
        failed: 0,
        sentAt: new Date().toISOString()
      })
    ).rejects.toThrow(/no entry id/)
  })
})

describe('ensureConsumerGroups', () => {
  it('creates one group per distinct stream and swallows BUSYGROUP', async () => {
    const xgroup = vi
      .fn()
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))
    const redis = { xgroup } as unknown as Redis

    // Three events, two distinct streams — orders twice, payments once.
    await ensureConsumerGroups(redis, {
      group: 'agent:test',
      consumer: 'c1',
      events: ['order.paid', 'order.refunded', 'payment.reconcile_mismatch']
    })

    expect(xgroup).toHaveBeenCalledTimes(2)
    expect(xgroup).toHaveBeenCalledWith('CREATE', 'tgshop:events:orders', 'agent:test', '$', 'MKSTREAM')
    expect(xgroup).toHaveBeenCalledWith('CREATE', 'tgshop:events:payments', 'agent:test', '$', 'MKSTREAM')
  })

  it('rethrows a non-BUSYGROUP failure instead of hiding a broken bus', async () => {
    const redis = {
      xgroup: vi.fn().mockRejectedValue(new Error('LOADING Redis is loading the dataset'))
    } as unknown as Redis

    await expect(
      ensureConsumerGroups(redis, { group: 'g', consumer: 'c', events: ['stock.low'] })
    ).rejects.toThrow(/LOADING/)
  })
})

describe('consumeEvents (once mode)', () => {
  function entry(id: string, fields: Record<string, string>): [string, string[]] {
    return [id, Object.entries(fields).flat()]
  }

  it('dispatches subscribed events and ACKs them only after the handler resolves', async () => {
    const calls: string[] = []
    const xack = vi.fn().mockImplementation(async () => {
      calls.push('xack')
      return 1
    })
    const reply = [
      [
        'tgshop:events:stock',
        [
          entry('1-1', {
            type: 'stock.depleted',
            schemaVersion: '1',
            emittedAt: new Date().toISOString(),
            data: JSON.stringify({ planId: 'p1', productId: 'pr1' })
          })
        ]
      ]
    ]
    const redis = {
      xreadgroup: vi.fn().mockResolvedValue(reply),
      xack
    } as unknown as Redis

    const seen: { name: EventName; payload: unknown }[] = []
    await consumeEvents(
      redis,
      { group: 'g', consumer: 'c', events: ['stock.depleted'], once: true },
      async (e) => {
        calls.push('handler')
        seen.push({ name: e.name, payload: e.payload })
      }
    )

    expect(seen).toEqual([{ name: 'stock.depleted', payload: { planId: 'p1', productId: 'pr1' } }])
    // ACK strictly after the handler — the at-least-once guarantee.
    expect(calls).toEqual(['handler', 'xack'])
    expect(xack).toHaveBeenCalledWith('tgshop:events:stock', 'g', '1-1')
  })

  it('ACKs unknown/unsubscribed event types without invoking the handler', async () => {
    const xack = vi.fn().mockResolvedValue(1)
    const reply = [
      [
        'tgshop:events:orders',
        [
          entry('2-1', { type: 'order.telepathy', data: '{}' }), // unknown type
          entry('2-2', {
            type: 'order.paid', // known but not subscribed by this consumer
            data: JSON.stringify({ orderId: 'o1' })
          })
        ]
      ]
    ]
    const redis = { xreadgroup: vi.fn().mockResolvedValue(reply), xack } as unknown as Redis

    const handler = vi.fn()
    await consumeEvents(
      redis,
      { group: 'g', consumer: 'c', events: ['order.refunded'], once: true },
      handler
    )

    expect(handler).not.toHaveBeenCalled()
    expect(xack).toHaveBeenCalledTimes(2)
  })

  it('leaves a failed entry UNACKED and reports it through onError', async () => {
    const xack = vi.fn().mockResolvedValue(1)
    const reply = [
      [
        'tgshop:events:payments',
        [
          entry('3-1', {
            type: 'payment.reconcile_mismatch',
            data: JSON.stringify({ provider: 'CRYPTOBOT', paymentId: 'pay1', orderId: null, kind: 'paid_no_order', detail: 'x' })
          })
        ]
      ]
    ]
    const redis = { xreadgroup: vi.fn().mockResolvedValue(reply), xack } as unknown as Redis

    const onError = vi.fn()
    await consumeEvents(
      redis,
      { group: 'g', consumer: 'c', events: ['payment.reconcile_mismatch'], once: true, onError },
      async () => {
        throw new Error('poison entry')
      }
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(xack).not.toHaveBeenCalled()
  })
})
