import { success } from '../../lib/response'
import { listDownloadTasks } from '../../lib/download/queue'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const status = query.status as string | undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0
  return success(listDownloadTasks({ status, limit, offset }))
})
