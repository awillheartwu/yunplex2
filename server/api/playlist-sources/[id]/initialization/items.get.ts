import { fail, success } from '../../../../lib/response'
import { getLatestInitialization, queryInitializationItems } from '../../../../lib/source-initialization/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''; const initialization = getLatestInitialization(id)
  if (!initialization) return fail('尚无首次媒体接管任务')
  const query = getQuery(event)
  return success(queryInitializationItems({ initializationId: initialization.id, tier: typeof query.tier === 'string' ? query.tier : undefined, decision: typeof query.decision === 'string' ? query.decision : undefined, search: typeof query.search === 'string' ? query.search : undefined, page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 50 }))
})
