import { success } from '../../lib/response'
import { queryFailureRecords } from '../../lib/tasks/failure-queries'
import { parseFailureRecordFilters } from '../../lib/api-filter-params'

export default defineEventHandler((event) => {
  return success(queryFailureRecords(parseFailureRecordFilters(getQuery(event))), 'ok')
})
