import { fail, success } from '../../../../lib/response'
import { cancelSourceInitialization } from '../../../../lib/source-initialization/service'
import { cancelQuickPlan } from '../../../../lib/source-initialization/quick-plan'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { getInitializationApplyRequest } from '../../../../lib/sync/request-store'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
export default defineEventHandler((event) => {
  try {
    const sourceId = getRouterParam(event, 'id') || '', initialization = getLatestInitialization(sourceId)
    const apply = initialization && getInitializationApplyRequest(initialization.id)
    if (apply && ['pending', 'running'].includes(apply.status)) {
      cancelQuickPlan(sourceId, initialization!.id)
      return success(null, '已请求取消本次处理，歌曲选择保留')
    }
    return cancelSourceInitialization(sourceId) ? success(null, '已发送取消请求') : fail('当前没有正在分析或应用的任务')
  } catch (error) { return initializationFailure(error) }
})
