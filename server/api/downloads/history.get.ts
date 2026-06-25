import { success } from '../../lib/response'
import { listDownloadTasks } from '../../lib/download/queue'
import { parseDownloadHistoryFilters } from '../../lib/api-filter-params'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const result = listDownloadTasks(parseDownloadHistoryFilters(query))
  return success({ items: result.items, total: result.total, earliestDate: result.earliestDate })
})
