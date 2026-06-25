import { success } from '../../lib/response'
import { clearDownloadTasks, clearQueuedDownloadTasks } from '../../lib/download/queue'

export default defineEventHandler((event) => {
  if (getQuery(event).scope === 'queue') {
    const cleared = clearQueuedDownloadTasks()
    return success({ cleared }, `已清空 ${cleared} 条等待或失败任务`)
  }

  clearDownloadTasks()
  return success(null, '下载记录已清空')
})
