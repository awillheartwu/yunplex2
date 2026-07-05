import { assertSetupCheckKey, runSetupCheck } from '../../lib/setup/checks'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: unknown; config?: unknown }>(event)
  try {
    const key = assertSetupCheckKey(body.key)
    const result = await runSetupCheck(key, body.config)
    if (!result.ok) {
      setResponseStatus(event, 400)
      return fail(result.message)
    }
    return success(result, result.message)
  } catch (err) {
    setResponseStatus(event, 400)
    return fail(err instanceof Error ? err.message : '初始化检查失败')
  }
})
