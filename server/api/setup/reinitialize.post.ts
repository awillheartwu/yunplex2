import { markSetupRequired } from '../../lib/auth/store'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ reason?: unknown }>(event)
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 200)
    : 'manual'

  try {
    const setup = markSetupRequired(reason)
    return success({ setup }, '已进入重新初始化流程')
  } catch (err) {
    setResponseStatus(event, 500)
    return fail(err instanceof Error ? err.message : '重新初始化失败')
  }
})
