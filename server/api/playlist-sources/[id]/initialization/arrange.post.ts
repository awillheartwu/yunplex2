import { fail, success } from '../../../../lib/response'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { arrangeInitializationPlan, type ArrangementScope } from '../../../../lib/source-initialization/automatic-plan'
import type { InitializationSelectionFilter } from '../../../../lib/source-initialization/types'
import { getSyncWorker } from '../../../../lib/sync/instance'

export default defineEventHandler(async event => {
  const body = await readBody<{ initializationId: string; scope: ArrangementScope; songIds?: number[]; filter?: InitializationSelectionFilter }>(event)
  if (!body || typeof body.initializationId !== 'string' || !body.initializationId || !['default', 'deferred', 'needs_review', 'conflict', 'selected'].includes(body.scope)) return fail('请选择有效的方案和自动安排范围')
  if (body.songIds !== undefined && (!Array.isArray(body.songIds) || body.songIds.some(id => !Number.isSafeInteger(id) || id <= 0))) return fail('请选择有效的歌曲')
  if (body.filter && (typeof body.filter.tier !== 'string' || (body.filter.search !== undefined && typeof body.filter.search !== 'string') || (body.filter.decision !== undefined && !['adopt', 'download', 'defer'].includes(body.filter.decision)) || (body.filter.excludeSongIds !== undefined && (!Array.isArray(body.filter.excludeSongIds) || body.filter.excludeSongIds.some(id => !Number.isSafeInteger(id) || id <= 0))))) return fail('无效的跨页选择范围')
  try {
    const result = arrangeInitializationPlan(getRouterParam(event, 'id') || '', body.initializationId, body.scope, { songIds: body.songIds, filter: body.filter })
    if (result.started) void getSyncWorker()?.runOnce()
    return success(result, body.scope === 'default' ? '已安排推荐候选，其余安排下载' : '已按首个候选安排')
  } catch (error) { return initializationFailure(error) }
})
