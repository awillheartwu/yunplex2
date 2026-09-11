import { success, fail } from '../../lib/response'
import { getSyncWorker } from '../../lib/sync/instance'
import { isSyncMode, type SyncMode } from '../../lib/sync/service-state'
import { isGlobalSyncMode } from '../../lib/sync/mode-policy'
import { getEnabledSources } from '../../lib/playlist/store'
import { requestSources } from '../../lib/sync/source-requests'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ mode?: SyncMode }>(event)
  const mode = body?.mode
  if (!isSyncMode(mode) || !isGlobalSyncMode(mode)) return fail('全局同步模式仅支持 normal、preview 或 full')
  try {
    const result = requestSources({ sourceIds: getEnabledSources().map(source => source.id), mode, trigger: 'user' })
    if (result.triggered) void getSyncWorker()?.runOnce()
    return success(result, result.triggered ? '已按来源接受请求，请查看各来源状态' : result.results[0]?.message)
  } catch (error) { return fail(error) }
})
