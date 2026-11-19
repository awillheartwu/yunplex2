import { markSetupComplete } from '../../lib/auth/store'
import { applyConfigUpdate } from '../../lib/config/apply'
import { SETUP_CHECK_LABELS, runRequiredSetupChecks } from '../../lib/setup/checks'
import { failDomain, success } from '../../lib/response'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ config?: unknown }>(event)
  try {
    const checks = await runRequiredSetupChecks(body.config)
    const failed = checks.find(check => !check.ok)
    if (failed) {
      setResponseStatus(event, 400)
      return failDomain(failed.code ?? 'unknown_error', `「${SETUP_CHECK_LABELS[failed.key]}」未通过：${failed.message}`)
    }

    const { updated } = applyConfigUpdate(body.config)
    const setup = markSetupComplete()
    return success({ setup, config: updated, checks }, '初始化已完成')
  } catch (err) {
    setResponseStatus(event, 400)
    return failDomain('unknown_error', err instanceof Error ? err.message : '初始化完成失败')
  }
})
