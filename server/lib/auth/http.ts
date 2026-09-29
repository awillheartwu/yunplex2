import { requestTransport } from './transport'
import type { AuthSession, CreatedSession } from './store'
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './store'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface AuthHttpEvent {
  node: {
    req: {
      method?: string
      url?: string
      headers: Record<string, string | string[] | undefined>
      socket?: { remoteAddress?: string; encrypted?: boolean }
    }
  }
}

export function getSessionToken(event: AuthHttpEvent): string | undefined {
  return readCookie(getHeaderValue(event, 'cookie'), SESSION_COOKIE_NAME)
}

export function setSessionCookie(event: AuthHttpEvent, session: CreatedSession): void {
  setCookie(event as never, SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: requestTransport(event).secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    expires: new Date(session.expiresAt),
  })
}

export function clearSessionCookie(event: AuthHttpEvent): void {
  deleteCookie(event as never, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: requestTransport(event).secure,
    path: '/',
  })
}

export function getClientMetadata(event: AuthHttpEvent): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: requestTransport(event).ipAddress,
    userAgent: getHeaderValue(event, 'user-agent') || '',
  }
}

export function isWriteRequest(event: AuthHttpEvent): boolean {
  return !SAFE_METHODS.has((event.node.req.method || 'GET').toUpperCase())
}

export function assertSameOrigin(event: AuthHttpEvent): void {
  if (!isWriteRequest(event)) return
  const requestOrigin = getRequestOrigin(event)
  const origin = getHeaderValue(event, 'origin')
  const referer = getHeaderValue(event, 'referer')

  if (origin) {
    if (origin !== requestOrigin) throw forbidden('请求来源不可信')
    return
  }

  if (referer) {
    try {
      if (new URL(referer).origin !== requestOrigin) throw forbidden('请求来源不可信')
      return
    } catch {
      throw forbidden('请求来源不可信')
    }
  }

  throw forbidden('缺少请求来源校验')
}

export function assertCsrfToken(event: AuthHttpEvent, session: AuthSession): void {
  if (!isWriteRequest(event)) return
  const csrfToken = getHeaderValue(event, 'x-csrf-token')
  if (!csrfToken || csrfToken !== session.csrfToken) {
    throw forbidden('安全令牌已失效，请刷新页面后重试')
  }
}

function forbidden(message: string) {
  return Object.assign(new Error(message), { statusCode: 403 })
}

function getHeaderValue(event: AuthHttpEvent, name: string): string | undefined {
  const value = event.node.req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function getRequestOrigin(event: AuthHttpEvent): string {
  const host = getHeaderValue(event, 'host') || 'localhost'
  const proto = requestTransport(event).secure ? 'https' : 'http'
  return `${proto}://${host}`
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  const parts = header.split(';')
  for (const part of parts) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) { try { return decodeURIComponent(value.join('=')) } catch { return undefined } }
  }
  return undefined
}
