import { assertCsrfToken, assertSameOrigin, getSessionToken, isWriteRequest } from '../lib/auth/http'
import { getSessionByToken, getSetupState, isDevAuthDisabled } from '../lib/auth/store'

const PUBLIC_ROUTES: Array<{ method?: string; path: string }> = [
  { method: 'GET', path: '/api/auth/state' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/reset' },
  { method: 'POST', path: '/api/setup/admin' },
  { method: 'GET', path: '/api/system/health' },
  { method: 'GET', path: '/api/system/ready' },
]

export default defineEventHandler((event) => {
  const path = (event.node.req.url || '/').split('?')[0] || '/'
  if (!path.startsWith('/api/')) return

  const method = (event.node.req.method || 'GET').toUpperCase()
  if (isWriteRequest(event)) assertSameOrigin(event)
  if (method === 'OPTIONS') return
  if (isDevAuthDisabled()) return
  if (isPublicRoute(method, path)) return

  const token = getSessionToken(event)
  const session = getSessionByToken(token)
  if (!session) {
    throw httpError(401, '请先登录')
  }

  const setup = getSetupState()
  if (!setup.completed && !path.startsWith('/api/setup/') && path !== '/api/auth/logout') {
    throw httpError(428, '请先完成初始化')
  }

  assertCsrfToken(event, session)
  event.context.auth = { session }
})

function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(route => route.path === path && (!route.method || route.method === method))
}

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode })
}
