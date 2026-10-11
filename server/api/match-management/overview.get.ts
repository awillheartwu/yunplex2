import type { MatchOverviewState } from '../../../types/match-management'
import { fail, success } from '../../lib/response'
import { queryMatchOverview } from '../../lib/sync/match-management-store'

const STATES = new Set<MatchOverviewState | 'needs_action' | 'problem'>([
  'needs_action', 'problem', 'matched', 'pending_alignment', 'historical_unverified', 'unmatched', 'binding_stale',
  'awaiting_manual', 'copyright_restricted', 'sync_failed', 'retry_paused', 'removed',
])

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const sourceId = typeof query.sourceId === 'string' ? query.sourceId.trim() : ''
  if (!sourceId) return fail('请选择歌单来源')
  const state = typeof query.state === 'string' && STATES.has(query.state as MatchOverviewState | 'needs_action' | 'problem')
    ? query.state as MatchOverviewState | 'needs_action' | 'problem'
    : undefined
  return success(queryMatchOverview({
    sourceId,
    origin: query.origin === 'scored' ? 'scored' : undefined,
    state,
    search: typeof query.search === 'string' ? query.search : undefined,
    includeRemoved: query.includeRemoved === '1' || state === 'removed',
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 50,
  }))
})
