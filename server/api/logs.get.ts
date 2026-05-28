import { readLogs } from '../lib/log/store'
import { success } from '../lib/response'
import type { LogLevel } from '../lib/log/types'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const level = query.level as LogLevel | undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 100
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0
  const dataDir = useRuntimeConfig().dataDir as string

  return success(readLogs(dataDir, { level, limit, offset }))
})
