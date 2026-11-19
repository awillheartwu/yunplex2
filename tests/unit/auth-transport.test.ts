import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestTransport, validateTrustedProxies } from '../../server/lib/auth/transport'
import { assertSameOrigin, setSessionCookie, clearSessionCookie, type AuthHttpEvent } from '../../server/lib/auth/http'
const event = (ip: string, headers: Record<string, string> = {}, tls = false): AuthHttpEvent => ({ node: { req: { method: 'POST', headers: { host: 'nas.example', ...headers }, socket: { remoteAddress: ip, encrypted: tls } } } })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('deployment transport trust', () => {
  it('ignores spoofed forwarding headers from direct clients', () => {
    vi.stubEnv('YUNPLEX2_TRUSTED_PROXIES', '')
    expect(requestTransport(event('192.168.1.2', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4' }))).toEqual({ secure: false, ipAddress: '192.168.1.2' })
  })
  it('walks proxy chains from the socket and stops at the first untrusted hop', () => {
    vi.stubEnv('YUNPLEX2_TRUSTED_PROXIES', '10.0.0.0/24,::1')
    expect(requestTransport(event('::ffff:10.0.0.2', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4,192.168.1.2,10.0.0.3' }))).toEqual({ secure: true, ipAddress: '192.168.1.2' })
    expect(() => assertSameOrigin(event('10.0.0.2', { origin: 'https://nas.example', 'x-forwarded-proto': 'https' }))).not.toThrow()
    expect(() => assertSameOrigin(event('192.168.1.2', { origin: 'https://nas.example', 'x-forwarded-proto': 'https' }))).toThrow()
  })
  it('rejects invalid deployment settings and ambiguous protocol headers', () => {
    vi.stubEnv('YUNPLEX2_TRUSTED_PROXIES', '*')
    expect(validateTrustedProxies).toThrow()
    vi.stubEnv('YUNPLEX2_TRUSTED_PROXIES', '::1/128')
    expect(() => requestTransport(event('::1', { 'x-forwarded-proto': 'https,http' }))).toThrow()
  })
  it('sets and clears cookies using the actual trusted transport even in production', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('YUNPLEX2_TRUSTED_PROXIES', '')
    const set = vi.fn(), del = vi.fn()
    vi.stubGlobal('setCookie', set); vi.stubGlobal('deleteCookie', del)
    for (const secure of [false, true]) {
      const req = event('192.168.1.2', {}, secure)
      setSessionCookie(req, { token: 'test', csrfToken: 'csrf', expiresAt: new Date(Date.now() + 10000).toISOString() })
      clearSessionCookie(req)
      expect(set.mock.lastCall?.[3]).toMatchObject({ secure, httpOnly: true, sameSite: 'strict' })
      expect(del.mock.lastCall?.[2]).toMatchObject({ secure, httpOnly: true, sameSite: 'strict' })
    }
  })
})
