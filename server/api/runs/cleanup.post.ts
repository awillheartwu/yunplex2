import { fail, success } from '../../lib/response'
import { cleanupRuns, parseRunCleanupRequest, type RunCleanupRequest } from '../../lib/run/cleanup'

export default defineEventHandler(async (event) => {
  const parsed = parseRunCleanupRequest(await readBody<RunCleanupRequest>(event))
  if (!parsed.ok) return fail(parsed.message)

  const result = cleanupRuns(parsed.filter)
  if (result.count === 0) return success(result, '没有符合条件的运行记录')
  return success(result, `已清理 ${result.count} 条运行记录`)
})
