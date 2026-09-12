import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked.addSubnet(address, prefix, 'ipv4')
// IPv6 must be global unicast. Exclude transition and documentation ranges too.
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(address, prefix, 'ipv6')
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

const MAX_RESPONSE_BYTES = 256 * 1024

/** Resolve once and pin the connection to that checked IP, preserving TLS hostname verification. */
export async function postSupplierJson(
  endpoint: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
): Promise<unknown> {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Supplier endpoint must be an HTTPS URL without credentials or fragment')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  signal.throwIfAborted()
  const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true })
  signal.throwIfAborted()
  const address = addresses[0]
  if (!address || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error('Supplier endpoint must resolve only to public IP addresses')
  }

  const safeHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (/^(host|connection|content-length|transfer-encoding|upgrade|expect|trailer|proxy-.*)$/i.test(key)) {
      throw new Error('Supplier configuration contains a reserved HTTP header')
    }
    safeHeaders[key.toLowerCase()] = value
  }

  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      agent: false,
      family: address.family,
      // Never perform another DNS lookup after validating the destination.
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address])
        else callback(null, address.address, address.family)
      },
      signal,
      headers: { ...safeHeaders, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      // No redirects: forwarding credentials or repeating fulfillment elsewhere is unsafe.
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy()
        reject(new Error(`Supplier returned HTTP ${res.statusCode ?? 'unknown'}`))
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('error', reject)
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy()
          reject(new Error('Supplier response exceeds the size limit'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new Error('Supplier returned invalid JSON')) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
