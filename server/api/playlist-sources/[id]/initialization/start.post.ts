import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { success } from '../../../../lib/response'
import { enqueueSourceInitialization } from '../../../../lib/source-initialization/service'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { getDb } from '../../../../lib/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  try {
    const body = await readBody<{ autoProcess?: boolean }>(event)
    if (body?.autoProcess !== undefined && typeof body.autoProcess !== 'boolean') throw new Error('开始方式无效')
    const request = enqueueSourceInitialization(id, 'user')
    getDb().prepare('UPDATE source_initializations SET auto_process=? WHERE id=? AND status=\'pending\'')
      .run(Number(body?.autoProcess ?? false), request.initializationId)
    void getSyncWorker()?.runOnce()
    return success({ ...request, initialization: getLatestInitialization(id) }, '首次媒体接管请求已接受，请查看请求状态')
  } catch (error) { return initializationFailure(error) }
})
