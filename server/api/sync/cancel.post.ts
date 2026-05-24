import { success, fail } from '../../lib/response'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(() => {
  const syncService = getSyncServiceInstance()
  const cancelled = syncService.cancelSync()
  if (cancelled) {
    return success(null, '已发送取消请求')
  }
  return fail('当前没有正在运行的同步任务')
})
