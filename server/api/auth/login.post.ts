import { clearRateLimit, recordRateLimitFailure, assertRateLimit } from '../../lib/auth/rate-limit'
import { createSession, hasAdminPassword, verifyAdminPassword } from '../../lib/auth/store'
import { getClientMetadata, setSessionCookie } from '../../lib/auth/http'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const metadata = getClientMetadata(event)
  const fingerprint = metadata.ipAddress
  try {
    assertRateLimit('login', fingerprint)
  } catch (err) {
    setResponseStatus(event, 429)
    return fail(err instanceof Error ? err.message : '尝试过于频繁')
  }

  const body = await readBody<{ password?: unknown }>(event)
  if (!hasAdminPassword()) {
    setResponseStatus(event, 428)
    return fail('请先完成初始化')
  }

  const password = typeof body.password === 'string' ? body.password : ''
  const ok = await verifyAdminPassword(password)
  if (!ok) {
    recordRateLimitFailure('login', fingerprint)
    setResponseStatus(event, 401)
    return fail('密码错误')
  }

  clearRateLimit('login', fingerprint)
  const session = await createSession(metadata)
  setSessionCookie(event, session)
  return success({
    authenticated: true,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  }, '登录成功')
})
