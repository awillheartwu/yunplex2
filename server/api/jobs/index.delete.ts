import { success } from '../../lib/response'
import { clearAllJobs } from '../../lib/job/store'

export default defineEventHandler(() => {
  clearAllJobs()
  return success(null, '所有任务已清空')
})
