import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { commitSourceInitialization } from '../../../../lib/source-initialization/service'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'

export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'id') || ''; const initialization = getLatestInitialization(sourceId)
  if (!initialization) return fail('尚无首次媒体接管方案')
  try {
    const body = await readBody<{ initializationId?: string }>(event)
    if (!body?.initializationId || body.initializationId !== initialization.id) return fail('接管方案已变化，请刷新后重新提交', 409, 'validation_failed')
    const result = await commitSourceInitialization(initialization.id)
    if (result.shouldSync) {
      void getSyncWorker()?.runOnce()
    }
    return success({ ...result, followUpRunId: null }, result.shouldSync ? '接管方案已应用，普通同步已排队' : '接管方案已应用')
  } catch (error) { return initializationFailure(error) }
})
