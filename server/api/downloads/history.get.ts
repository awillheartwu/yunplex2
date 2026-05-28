import { success } from '../../lib/response'
import { listDownloads } from '../../lib/download/store'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0
  const from = query.from as string | undefined
  const to = query.to as string | undefined
  return success(listDownloads(limit, offset, from, to))
})
