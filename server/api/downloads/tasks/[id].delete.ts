import { success, fail } from '../../../lib/response'
import { deleteDownloadTask, getDownloadTask } from '../../../lib/download/queue'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status === 'downloading' || task.status === 'tagging') {
    return fail('正在执行的下载任务不能删除')
  }

  const deleted = deleteDownloadTask(id)
  if (!deleted) return fail('删除下载任务失败')
  return success({ deleted: true }, '下载任务已删除')
})
