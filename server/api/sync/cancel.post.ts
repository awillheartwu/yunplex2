import { cancelSourceRequests } from '../../lib/sync/source-request-cancellation'
import { success, fail } from '../../lib/response'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const syncService = getSyncServiceInstance()
  const body = await readBody<{ runId?: string }>(event)
  if (body?.runId && syncService.getState().currentRunId !== body.runId) return fail('运行状态已变化，请刷新后重试', 1, 'validation_failed')
  const cancelled = cancelSourceRequests(() => syncService.cancelSync())
  if (cancelled) {
    return success(null, '已发送取消请求')
  }
  return fail('当前没有正在运行的同步任务')
})
