import { clearSessionCookie } from '../../lib/auth/http'
import { revokeAllSessions, setAdminPassword, validatePassword, verifyAdminPassword } from '../../lib/auth/store'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ currentPassword?: unknown; newPassword?: unknown }>(event)
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const currentOk = await verifyAdminPassword(currentPassword)
  if (!currentOk) {
    setResponseStatus(event, 401)
    return fail('当前密码错误')
  }

  try {
    await setAdminPassword(validatePassword(body.newPassword))
  } catch (err) {
    setResponseStatus(event, 400)
    return fail(err instanceof Error ? err.message : '新密码不符合要求')
  }

  revokeAllSessions()
  clearSessionCookie(event)
  return success({ authenticated: false }, '管理员密码已更新，请重新登录')
})
