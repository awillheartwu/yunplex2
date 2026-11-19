import { success, fail } from '../../../../lib/response'
import { getDownloadTask } from '../../../../lib/download/queue'
import { retryTargets } from '../../../../lib/tasks/retry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status !== 'failed') return fail('只能重试失败的任务')

  try {
    const result = retryTargets([{ sourceId: task.sourceId, songId: task.songId, downloadTaskIds: [id] }])
    return success(result, '已提交歌曲重新处理')
  } catch (error) {
    return fail(error, 1, 'validation_failed')
  }
})
