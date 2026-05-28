import { success, fail } from '../../../../lib/response'
import { getDownloadTask, updateTaskState } from '../../../../lib/download/queue'
import { getSyncServiceInstance } from '../../../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status !== 'failed') return fail('只能重试失败的任务')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  // Reset to pending — will be picked up by next sync
  updateTaskState(id, { status: 'pending', progress: 0, error: undefined })

  return success({ retried: true }, '任务已重新加入队列，将在下次同步时处理')
})
