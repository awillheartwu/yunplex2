import { fail, success } from '../../../../lib/response'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { arrangeInitializationPlan } from '../../../../lib/source-initialization/automatic-plan'
import { getSyncWorker } from '../../../../lib/sync/instance'

export default defineEventHandler(async event => {
  const body = await readBody<{ initializationId: string; scope: 'default' | 'deferred' | 'needs_review' }>(event)
  if (!body || typeof body.initializationId !== 'string' || !body.initializationId || !['default', 'deferred', 'needs_review'].includes(body.scope)) return fail('请选择有效的方案和自动安排范围')
  try {
    const result = arrangeInitializationPlan(getRouterParam(event, 'id') || '', body.initializationId, body.scope)
    if (result.started) void getSyncWorker()?.runOnce()
    return success(result, '已按最高分安排可用候选，其余安排下载')
  } catch (error) { return initializationFailure(error) }
})
