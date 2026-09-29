import { assertSetupCheckKey, runSetupCheck } from '../../lib/setup/checks'
import { failDomain, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: unknown; config?: unknown }>(event)
  try {
    const key = assertSetupCheckKey(body.key)
    const result = await runSetupCheck(key, body.config)
    if (!result.ok) {
      setResponseStatus(event, 400)
      return failDomain(result.code ?? 'unknown_error', result.message)
    }
    return success(result, result.message)
  } catch (err) {
    setResponseStatus(event, 400)
    return failDomain('validation_failed', err instanceof Error ? err.message : '初始化检查失败')
  }
})
