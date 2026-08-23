import { ConfigValidationError } from '../../lib/config/validation'
import { assertConnectionTestSection, runConnectionTest } from '../../lib/config/connection-test-runner'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ section?: unknown; config?: unknown }>(event)
  try {
    const result = await runConnectionTest(assertConnectionTestSection(body.section), body.config)
    return success(result.data, result.message)
  } catch (error) {
    if (error instanceof ConfigValidationError) return fail(error.message)
    return fail(error instanceof Error ? error.message : '连接测试失败')
  }
})
