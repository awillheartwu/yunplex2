import { markSetupComplete } from '../../lib/auth/store'
import { applyConfigUpdate } from '../../lib/config/apply'
import { runRequiredSetupChecks } from '../../lib/setup/checks'
import { fail, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ config?: unknown }>(event)
  try {
    const checks = await runRequiredSetupChecks(body.config)
    const failed = checks.find(check => !check.ok)
    if (failed) {
      setResponseStatus(event, 400)
      return fail(failed.message)
    }

    const { updated } = applyConfigUpdate(body.config)
    const setup = markSetupComplete()
    return success({ setup, config: updated, checks }, '初始化已完成')
  } catch (err) {
    setResponseStatus(event, 400)
    return fail(err instanceof Error ? err.message : '初始化完成失败')
  }
})
