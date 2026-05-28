import { success } from '../../lib/response'
import { clearDownloadTasks } from '../../lib/download/queue'

export default defineEventHandler(() => {
  clearDownloadTasks()
  return success(null, '下载记录已清空')
})
