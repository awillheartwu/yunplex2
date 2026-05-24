import { success } from '../../lib/response'
import { listJobs } from '../../lib/job/store'
import type { JobStatus } from '../../lib/job/types'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const status = query.status as JobStatus | undefined
  const search = query.search as string | undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0

  const result = listJobs({ status, search, limit, offset })
  return success(result)
})
