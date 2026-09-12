import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postSupplierJson } from '../supplier-http.js'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))

const publicAddress = { address: '93.184.215.14', family: 4 }
const send = (url: string, headers: Record<string, string> = {}, signal = new AbortController().signal) =>
  postSupplierJson(url, headers, '{"orderId":"test"}', signal)

function response(status: number, body: string) {
  vi.mocked(request).mockImplementation(((_url: unknown, _options: unknown, callback: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = () => {
      const res = Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status })
      callback(res)
    }
    return req
  }) as typeof request)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(lookup).mockResolvedValue([publicAddress] as never)
  response(200, '{"payload":"delivered"}')
})

describe('supplier HTTP boundary', () => {
  it.each([
    'http://supplier.example/deliver', 'file:///etc/passwd',
    'https://user:password@supplier.example/deliver', 'https://supplier.example/#fragment',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/',
    'https://10.1.2.3/', 'https://169.254.169.254/', 'https://100.100.100.200/',
    'https://172.16.0.1/', 'https://192.168.1.1/', 'https://0.0.0.0/',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fc00::1]/',
    'https://[fe80::1]/', 'https://[64:ff9b::7f00:1]/', 'https://[2002:7f00:1::]/'
  ])('blocks unsafe destination %s before sending a request', async (url) => {
    await expect(send(url)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('blocks a hostname if any resolved address is private', async () => {
    vi.mocked(lookup).mockResolvedValue([publicAddress, { address: '127.0.0.1', family: 4 }] as never)
    await expect(send('https://supplier.example')).rejects.toThrow('public IP')
    expect(request).not.toHaveBeenCalled()
  })

  it('pins the checked address without changing the TLS hostname', async () => {
    await expect(send('https://supplier.example/deliver')).resolves.toEqual({ payload: 'delivered' })
    const [url, options] = vi.mocked(request).mock.calls[0] as unknown as [URL, {
      lookup: (host: string, opts: { all: boolean }, cb: (...args: unknown[]) => void) => void
      agent: boolean
      signal: AbortSignal
    }]
    expect(url.hostname).toBe('supplier.example')
    expect(options.agent).toBe(false)
    const callback = vi.fn()
    options.lookup('supplier.example', { all: false }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, publicAddress.address, 4)
    options.lookup('supplier.example', { all: true }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, [publicAddress])
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it.each(['Host', 'Transfer-Encoding', 'Content-Length', 'Connection', 'Proxy-Authorization'])('rejects reserved header %s', async (header) => {
    await expect(send('https://supplier.example', { [header]: 'unsafe' })).rejects.toThrow('reserved')
    expect(request).not.toHaveBeenCalled()
  })

  it('never follows a redirect', async () => {
    response(302, '')
    await expect(send('https://supplier.example')).rejects.toThrow('HTTP 302')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('caps response size before JSON parsing', async () => {
    response(200, 'x'.repeat(256 * 1024 + 1))
    await expect(send('https://supplier.example')).rejects.toThrow('size limit')
  })

  it('rejects invalid JSON', async () => {
    response(200, 'not json')
    await expect(send('https://supplier.example')).rejects.toThrow('invalid JSON')
  })

  it('does not send a request if cancelled during DNS resolution', async () => {
    const controller = new AbortController()
    vi.mocked(lookup).mockImplementation(async () => {
      controller.abort()
      return [publicAddress] as never
    })
    await expect(send('https://supplier.example', {}, controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('forwards cancellation to the socket', async () => {
    const signal = new AbortController().signal
    await send('https://supplier.example', {}, signal)
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ signal }), expect.any(Function))
  })
})
