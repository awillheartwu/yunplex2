import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'
import { getLatestInitialization, setInitializationDecisions } from '../../../../lib/source-initialization/store'
import type { InitializationDecision, InitializationTier } from '../../../../lib/source-initialization/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''; const initialization = getLatestInitialization(id)
  if (!initialization || initialization.status !== 'awaiting_review') return fail('当前没有等待确认的接管方案')
  const body = await readBody<{ initializationId?: string; songIds?: number[]; tier?: InitializationTier; decision?: InitializationDecision }>(event)
  if (body.initializationId !== initialization.id) return fail('接管方案已变化，请刷新后重新操作', 409, 'validation_failed')
  if (!body.decision || !['adopt', 'download', 'defer'].includes(body.decision)) return fail('无效的处理决定')
  try { return success({ changed: setInitializationDecisions({ initializationId: initialization.id, songIds: body.songIds, tier: body.tier, decision: body.decision }) }, '接管方案已更新') }
  catch (error) { return initializationFailure(error) }
})
