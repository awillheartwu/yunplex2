import { fail, success } from '../../../../lib/response'
import { skipSourceInitialization } from '../../../../lib/source-initialization/service'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
export default defineEventHandler(async (event) => {
  const body = await readBody<{ confirmRisk?: boolean; initializationId?: string }>(event)
  if (body.confirmRisk !== true) return fail('请先确认跳过接管的下载风险')
  const sourceId = getRouterParam(event, 'id') || ''
  if (!body.initializationId || getLatestInitialization(sourceId)?.id !== body.initializationId) return fail('接管方案已变化，请刷新后重新操作', 409, 'validation_failed')
  try {
    skipSourceInitialization(sourceId)
    return success(null, '已跳过首次媒体接管')
  } catch (error) {
    return fail(error)
  }
})
