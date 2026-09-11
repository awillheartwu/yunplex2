import { success, fail } from '../../../lib/response'
import { getSyncWorker } from '../../../lib/sync/instance'
import { requestSources } from '../../../lib/sync/source-requests'
import type { SyncRunOptions } from '../../../lib/sync/service-state'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')
  try {
    const body = await readBody<Pick<SyncRunOptions, 'mode' | 'takeOverExternal'>>(event)
    const result = requestSources({ ...body, sourceIds: [id], trigger: 'user' })
    if (result.triggered) void getSyncWorker()?.runOnce()
    return success({ ...result, sourceId: id, ...result.results[0] }, result.results[0]?.message)
  } catch (error) { return fail(error) }
})
