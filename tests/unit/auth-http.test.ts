import { describe, expect, it } from 'vitest'
import { assertCsrfToken, assertSameOrigin, type AuthHttpEvent } from '../../server/lib/auth/http'
import type { AuthSession } from '../../server/lib/auth/store'

function event(method: string, headers: Record<string, string> = {}): AuthHttpEvent {
  return {
    node: {
      req: {
        method,
        url: '/api/config',
        headers: {
          host: 'localhost:3001',
          ...headers,
        },
        socket: { remoteAddress: '127.0.0.1' },
      },
    },
  }
}

const session: AuthSession = {
  id: 'session-1',
  tokenHash: 'hash',
  csrfToken: 'csrf-token',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  revokedAt: null,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
}

describe('auth HTTP guards', () => {
  it('accepts same-origin write requests', () => {
    expect(() => assertSameOrigin(event('POST', { origin: 'http://localhost:3001' }))).not.toThrow()
  })

  it('rejects cross-origin write requests', () => {
    expect(() => assertSameOrigin(event('POST', { origin: 'http://evil.example' }))).toThrow('请求来源不可信')
  })

  it('rejects write requests without origin or referer', () => {
    expect(() => assertSameOrigin(event('POST'))).toThrow('缺少请求来源校验')
  })

  it('requires the csrf header for write requests', () => {
    expect(() => assertCsrfToken(event('POST', { 'x-csrf-token': 'csrf-token' }), session)).not.toThrow()
    expect(() => assertCsrfToken(event('POST'), session)).toThrow('安全令牌已失效')
  })

  it('does not require csrf for safe requests', () => {
    expect(() => assertCsrfToken(event('GET'), session)).not.toThrow()
  })
})
