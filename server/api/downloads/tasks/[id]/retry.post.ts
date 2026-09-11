import { success, fail } from '../../../../lib/response'
import { getDownloadTask, requeueFailedDownloadTasks } from '../../../../lib/download/queue'
import { requestDownloadProcessing } from '../../../../lib/download/worker'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status !== 'failed') return fail('只能重试失败的任务')

  const [requeued] = requeueFailedDownloadTasks([id])
  if (!requeued) return fail('任务已被其他活跃下载取代，请稍后再试')
  void requestDownloadProcessing().catch(() => undefined)

  return success({ retried: true }, '重试已启动')
})
