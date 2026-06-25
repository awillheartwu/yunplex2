import { success } from '../../lib/response'
import { parseRunFilters } from '../../lib/api-filter-params'
import { listRuns } from '../../lib/run/store'

export default defineEventHandler((event) => {
  return success(listRuns(parseRunFilters(getQuery(event))))
})
