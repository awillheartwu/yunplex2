import type { SongIdentityEventType } from '../../../types/match-management'
import { fail, success } from '../../lib/response'
import { querySongIdentityEvents } from '../../lib/sync/match-management-store'

const EVENT_TYPES = new Set<SongIdentityEventType>([
  'auto_bind', 'auto_migrate', 'invalidate', 'manual_accept', 'manual_reject',
  'manual_rebind', 'manual_reevaluate', 'manual_exclude', 'migration_snapshot',
])

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const rawActor = typeof query.actorType === 'string' ? query.actorType : ''
  if (rawActor && rawActor !== 'system' && rawActor !== 'admin') return fail('无效的操作者类型')
  const rawType = typeof query.eventType === 'string' ? query.eventType : ''
  if (rawType && !EVENT_TYPES.has(rawType as SongIdentityEventType)) return fail('无效的身份事件类型')
  const songId = Number(query.neteaseSongId)
  return success(querySongIdentityEvents({
    sourceId: typeof query.sourceId === 'string' && query.sourceId ? query.sourceId : undefined,
    neteaseSongId: Number.isSafeInteger(songId) && songId > 0 ? songId : undefined,
    actorType: rawActor as 'system' | 'admin' || undefined,
    eventType: rawType as SongIdentityEventType || undefined,
    from: typeof query.from === 'string' && query.from ? query.from : undefined,
    to: typeof query.to === 'string' && query.to ? query.to : undefined,
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 25,
  }))
})
