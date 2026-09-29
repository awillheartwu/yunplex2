import { BlockList, isIP } from 'node:net'
import type { AuthHttpEvent } from './http'

let cachedSetting: string | undefined
let trusted = new BlockList()

function normalizeAddress(value: string): string {
  return value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value
}

/** Deployment configuration only. Never trust headers to select the proxy policy. */
export function validateTrustedProxies(): void {
  const setting = process.env.YUNPLEX2_TRUSTED_PROXIES || ''
  if (setting === cachedSetting) return
  const next = new BlockList()
  for (const entry of setting.split(',').map(value => value.trim()).filter(Boolean)) {
    const [raw, prefix, extra] = entry.split('/')
    const address = normalizeAddress(raw || '')
    const version = isIP(address)
    if (!version || extra !== undefined) throw new Error('YUNPLEX2_TRUSTED_PROXIES must contain IP addresses or CIDRs')
    const family = version === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) next.addAddress(address, family)
    else {
      const bits = Number(prefix)
      if (!/^\d+$/.test(prefix) || bits < 0 || bits > (version === 4 ? 32 : 128)) throw new Error('Invalid trusted proxy CIDR prefix')
      next.addSubnet(address, bits, family)
    }
  }
  trusted = next
  cachedSetting = setting
}

function isTrusted(address: string): boolean {
  const version = isIP(address)
  return !!version && trusted.check(address, version === 4 ? 'ipv4' : 'ipv6')
}

export function requestTransport(event: AuthHttpEvent): { secure: boolean; ipAddress: string } {
  validateTrustedProxies()
  const req = event.node.req
  let secure = req.socket?.encrypted === true
  let ipAddress = normalizeAddress(req.socket?.remoteAddress || '')
  if (!isTrusted(ipAddress)) return { secure, ipAddress }
  const proto = req.headers['x-forwarded-proto']
  if (proto !== undefined) {
    if (proto !== 'http' && proto !== 'https') throw Object.assign(new Error('Invalid forwarded protocol'), { statusCode: 400 })
    secure = proto === 'https'
  }
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    // Walk from the trusted socket towards the first untrusted hop, not the
    // client-controlled leftmost entry. Malformed chains fall back to socket IP.
    const chain = forwarded.split(',').map(value => normalizeAddress(value.trim()))
    if (chain.length <= 32 && chain.every(value => isIP(value))) {
      for (const address of chain.reverse()) {
        if (!isTrusted(ipAddress)) break
        ipAddress = address
      }
    }
  }
  return { secure, ipAddress }
}
