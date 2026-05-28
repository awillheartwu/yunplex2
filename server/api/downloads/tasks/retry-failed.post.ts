import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { getDb } from '../../../lib/db'

export default defineEventHandler(async () => {
  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  const db = getDb()
  const result = db.prepare(
    "UPDATE download_tasks SET status = 'pending', error = NULL, progress = 0, updated_at = ? WHERE status = 'failed'",
  ).run(new Date().toISOString())

  return success({ count: result.changes }, `${result.changes} 个失败任务已重新加入队列`)
})
