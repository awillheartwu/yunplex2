import { clearSessionCookie, getSessionToken } from '../../lib/auth/http'
import { revokeSessionByToken } from '../../lib/auth/store'
import { success } from '../../lib/response'

export default defineEventHandler((event) => {
  revokeSessionByToken(getSessionToken(event))
  clearSessionCookie(event)
  return success({ authenticated: false }, '已退出登录')
})
