import { success, fail } from '../../../lib/response'
import { requeueFailedDownloadTasks } from '../../../lib/download/queue'
import { requestDownloadProcessing } from '../../../lib/download/worker'
import { getFailureRecords, incrementFailureRetries, setFailureRecordStatus } from '../../../lib/tasks/failure-records'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)

  if (!body?.ids || body.ids.length === 0) {
    return fail('请提供要重试的失败项 ID 列表')
  }

  const records = getFailureRecords(body.ids)
  const retryableRecords = records.filter(record => record.retryable)
  const taskIds = [...new Set(retryableRecords.flatMap(record => record.downloadTaskIds))]
  if (taskIds.length === 0) {
    const hasPolicyBlockedRecord = records.some(record => !record.retryable)
    return success({ count: 0 }, hasPolicyBlockedRecord
      ? '所选问题的错误策略不允许直接重试'
      : '这些问题需要从对应运行或同步源重新执行')
  }

  const requeued = requeueFailedDownloadTasks(taskIds)
  if (requeued.length === 0) {
    return success({ count: 0 }, '所选任务已在其他下载中处理')
  }
  const requeuedIds = new Set(requeued.map(task => task.id))
  const affectedRecordIds = retryableRecords
    .filter(record => record.downloadTaskIds.some(id => requeuedIds.has(id)))
    .map(record => record.id)
  incrementFailureRetries(affectedRecordIds)
  setFailureRecordStatus(affectedRecordIds, 'open')
  void requestDownloadProcessing().catch(() => undefined)

  return success({ count: requeued.length }, `${requeued.length} 个失败项已重新排队`)
})
