import { success } from '../../lib/response'
import { listDownloadTasks } from '../../lib/download/queue'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0
  const from = query.from as string | undefined
  const to = query.to as string | undefined
  const search = query.search as string | undefined
  const result = listDownloadTasks({ status: 'done', limit, offset, from, to, search })
  return success({ items: result.items, total: result.total, earliestDate: result.earliestDate })
})
