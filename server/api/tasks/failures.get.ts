import { success } from '../../lib/response'
import { queryFailures } from '../../lib/tasks/failure-store'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const failureKind = (query.failureKind as string) || undefined

  const result = queryFailures({
    type: (query.type as string) || undefined,
    failureKind,
    // Exclude copyright by default; but when user explicitly filters for it, include it
    excludeCopyright: !failureKind || failureKind !== 'copyright_restricted',
    sourceId: (query.sourceId as string) || undefined,
    page: query.page ? Number(query.page) : 1,
    limit: query.limit ? Number(query.limit) : 50,
    search: (query.search as string) || undefined,
  })

  return success(result, 'ok')
})
