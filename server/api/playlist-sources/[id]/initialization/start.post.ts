import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { getSyncWorker } from '../../../../lib/sync/instance'
import { success } from '../../../../lib/response'
import { enqueueSourceInitialization } from '../../../../lib/source-initialization/service'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''
  try {
    const request = enqueueSourceInitialization(id, 'user')
    void getSyncWorker()?.runOnce()
    return success({ ...request, initialization: getLatestInitialization(id) }, '首次媒体接管请求已接受，请查看请求状态')
  } catch (error) { return initializationFailure(error) }
})
