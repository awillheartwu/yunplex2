import { safeTokenEqual } from '../../lib/auth/crypto'
import { getClientMetadata } from '../../lib/auth/http'
import { assertRateLimit, clearRateLimit, recordRateLimitFailure } from '../../lib/auth/rate-limit'
import {
  isResetTokenConsumed,
  markResetTokenConsumed,
  revokeAllSessions,
  setAdminPassword,
  validatePassword,
} from '../../lib/auth/store'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const resetToken = process.env.YUNPLEX2_ADMIN_RESET_TOKEN
  if (!resetToken) {
    setResponseStatus(event, 404)
    return fail('未启用管理员密码重置')
  }

  const metadata = getClientMetadata(event)
  const fingerprint = metadata.ipAddress
  try {
    assertRateLimit('reset', fingerprint)
  } catch (err) {
    setResponseStatus(event, 429)
    return fail(err instanceof Error ? err.message : '尝试过于频繁')
  }

  const body = await readBody<{ resetToken?: unknown; password?: unknown }>(event)
  const candidate = typeof body.resetToken === 'string' ? body.resetToken : ''
  if (isResetTokenConsumed(resetToken) || !candidate || !safeTokenEqual(candidate, resetToken)) {
    recordRateLimitFailure('reset', fingerprint)
    setResponseStatus(event, 401)
    return fail('重置令牌无效或已使用')
  }

  try {
    await setAdminPassword(validatePassword(body.password))
  } catch (err) {
    setResponseStatus(event, 400)
    return fail(err instanceof Error ? err.message : '密码不符合要求')
  }

  revokeAllSessions()
  markResetTokenConsumed(resetToken)
  clearRateLimit('reset', fingerprint)
  return success({ reset: true }, '管理员密码已重置，请重新登录')
})
