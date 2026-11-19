import { success } from '../../lib/response'
import { parseFailureRecordFilters } from '../../lib/api-filter-params'
import { queryFailureGroups } from '../../lib/tasks/failure-groups'

export default defineEventHandler(event => success(queryFailureGroups(parseFailureRecordFilters(getQuery(event)))))
