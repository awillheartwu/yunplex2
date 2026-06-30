import { fail, success } from '../../../lib/response'
import { parseRunCleanupRequest, previewRunCleanup, type RunCleanupRequest } from '../../../lib/run/cleanup'

export default defineEventHandler(async (event) => {
  const parsed = parseRunCleanupRequest(await readBody<RunCleanupRequest>(event))
  if (!parsed.ok) return fail(parsed.message)
  return success(previewRunCleanup(parsed.filter))
})
