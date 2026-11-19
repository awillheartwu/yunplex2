import { initializationFailure } from '../../../lib/source-initialization/errors'
import { success } from '../../../lib/response'
import { requestMatchingReanalysis } from '../../../lib/source-initialization/requests'
import { getSyncWorker } from '../../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  try {
    const sourceId = getRouterParam(event, 'id') || ''
    const result = requestMatchingReanalysis(sourceId)
    void getSyncWorker()?.runOnce()
    return success(result, '已开始重新分析自动匹配')
  } catch (error) {
    return initializationFailure(error)
  }
})
