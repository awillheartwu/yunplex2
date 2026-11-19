import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { restartSourceInitialization } from '../../../../lib/source-initialization/requests'

export default defineEventHandler(async (event) => {
  try {
    const sourceId = getRouterParam(event, 'id') || ''
    const body = await readBody<{ initializationId?: string }>(event)
    if (!body?.initializationId) return fail('缺少当前接管方案 ID，请刷新')
    const result = restartSourceInitialization(sourceId, body.initializationId)
    void getSyncWorker()?.runOnce()
    return success(result, '已创建新的只读分析请求')
  } catch (error) { return initializationFailure(error) }
})
