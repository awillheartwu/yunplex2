import { getClientMetadata, setSessionCookie } from '../../lib/auth/http'
import { assertRateLimit, clearRateLimit, recordRateLimitFailure } from '../../lib/auth/rate-limit'
import { createSession, getSetupState, hasAdminPassword, setAdminPassword, validatePassword } from '../../lib/auth/store'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const setup = getSetupState()
  if (setup.completed) {
    setResponseStatus(event, 409)
    return fail('初始化已完成')
  }
  if (hasAdminPassword()) {
    setResponseStatus(event, 409)
    return fail('管理员密码已创建，请直接登录继续初始化')
  }

  const metadata = getClientMetadata(event)
  const fingerprint = metadata.ipAddress
  try {
    assertRateLimit('setup-admin', fingerprint)
  } catch (err) {
    setResponseStatus(event, 429)
    return fail(err instanceof Error ? err.message : '尝试过于频繁')
  }

  const body = await readBody<{ password?: unknown }>(event)
  try {
    await setAdminPassword(validatePassword(body.password))
  } catch (err) {
    recordRateLimitFailure('setup-admin', fingerprint)
    setResponseStatus(event, 400)
    return fail(err instanceof Error ? err.message : '密码不符合要求')
  }

  clearRateLimit('setup-admin', fingerprint)
  const session = await createSession(metadata)
  setSessionCookie(event, session)
  return success({
    authenticated: true,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  }, '管理员密码已创建')
})
