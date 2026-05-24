import { clearLogs } from '../lib/log/store'
import { success } from '../lib/response'

export default defineEventHandler(() => {
  const dataDir = useRuntimeConfig().dataDir as string
  clearLogs(dataDir)
  return success(null, '日志已清空')
})
