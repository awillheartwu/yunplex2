import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { requestInitializationApply } from '../../../../lib/source-initialization/requests'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'

export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'id') || ''; const initialization = getLatestInitialization(sourceId)
  if (!initialization) return fail('尚无首次媒体接管方案')
  try {
    const body = await readBody<{ initializationId?: string; confirmDeferred?: boolean }>(event)
    if (!body?.initializationId || body.initializationId !== initialization.id) return fail('接管方案已变化，请刷新后重新提交', 409, 'validation_failed')
    const result = requestInitializationApply(sourceId, initialization.id, body.confirmDeferred === true)
    void getSyncWorker()?.runOnce()
    return success(result, result.status === 'completed' ? '歌曲安排已应用' : '歌曲安排已排队，后台会继续下载并同步')
  } catch (error) { return initializationFailure(error) }
})
