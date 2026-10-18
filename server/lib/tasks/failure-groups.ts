import { getDb } from '../db'
import { sanitizeDiagnosticMessage } from '../domain-error'
import { parseFailureRecordFilters } from '../api-filter-params'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { buildFailureRecordQuery, RETRYABLE_FAILURE_SQL, type FailureRecordFilter, type FailureRecordStatus } from './failure-records'
import { failureReasonGroupKey } from './failure-identity'

export interface FailureGroup {
  /** A retained member identifies the exact kind and reason without putting diagnostic text in URLs. */
  id: string
  key: string
  failureKind: string
  failureReason: string
  label: string
  total: number
  songCount: number
  sourceCount: number
  occurrenceCount: number
  retryableCount: number
  ignorableCount: number
  retryUnavailableReason: string
  firstSeenAt: string
  lastSeenAt: string
}

export function queryFailureGroups(filter: FailureRecordFilter = {}) {
  const db = getDb()
  const { where, from, params } = buildFailureRecordQuery(filter)
  const grouped = `${from} ${where} GROUP BY fr.failure_kind,
    CASE WHEN fr.failure_kind = 'copyright_restricted' THEN '' ELSE fr.failure_reason END`
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM (SELECT 1 ${grouped})`).get(...params) as { count: number }).count
  const recordTotal = (db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params) as { count: number }).count
  const rows = db.prepare(`
    SELECT MIN(fr.id) AS id, fr.failure_kind, MIN(fr.failure_reason) AS failure_reason, COUNT(*) AS total,
      COUNT(DISTINCT COALESCE(CAST(fr.song_id AS TEXT), fr.song_name || ':' || fr.artist)) AS song_count,
      COUNT(DISTINCT COALESCE(fr.source_id, 'manual')) AS source_count,
      SUM(fr.occurrence_count) AS occurrence_count,
      SUM(CASE WHEN ${RETRYABLE_FAILURE_SQL} THEN 1 ELSE 0 END) AS linked_count,
      SUM(CASE WHEN fr.status IN ('open','paused') THEN 1 ELSE 0 END) AS ignorable_count,
      MIN(fr.first_seen_at) AS first_seen_at, MAX(fr.last_seen_at) AS last_seen_at
    ${grouped}
    ORDER BY MAX(fr.last_seen_at) DESC, MIN(fr.id)
    LIMIT ? OFFSET ?
  `).all(...params, filter.limit ?? 50, filter.offset ?? 0) as Array<{
    id: string; failure_kind: string; failure_reason: string; total: number; song_count: number;
    source_count: number; occurrence_count: number; linked_count: number; ignorable_count: number; first_seen_at: string; last_seen_at: string;
  }>
  const items: FailureGroup[] = rows.map(row => {
    const reason = sanitizeDiagnosticMessage(row.failure_reason) || ''
    const definition = resolveDomainErrorDefinition(row.failure_kind, reason)
    return {
      id: row.id, key: failureReasonGroupKey(row.failure_kind, row.failure_reason), failureKind: definition.code,
      failureReason: row.failure_kind === 'copyright_restricted' ? definition.userMessage : reason || definition.userMessage,
      label: definition.label, total: row.total, songCount: row.song_count, sourceCount: row.source_count,
      occurrenceCount: row.occurrence_count, retryableCount: row.linked_count,
      ignorableCount: row.ignorable_count,
      retryUnavailableReason: '缺少可重新处理的歌曲或文件任务，请查看关联运行',
      firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
    }
  })
  return { items, total, recordTotal }
}

export interface FailureMutationSelection {
  ids?: string[]
  groupId?: string
  groupKey?: string
  allMatching?: boolean
  excludeIds?: string[]
  filter?: Record<string, unknown>
}

export function resolveFailureMutationIds(body: FailureMutationSelection | null | undefined, status: FailureRecordStatus | readonly FailureRecordStatus[]): string[] {
  const allowedStatuses = typeof status === 'string' ? [status] : status
  if (Array.isArray(body?.ids)) {
    const ids = [...new Set(body.ids.filter(id => typeof id === 'string' && id.length > 0))]
    if (ids.length === 0) return []
    const rows = getDb().prepare(`SELECT id FROM failure_records WHERE id IN (${ids.map(() => '?').join(',')})
      AND status IN (${allowedStatuses.map(() => '?').join(',')})`).all(...ids, ...allowedStatuses) as { id: string }[]
    return rows.map(row => row.id)
  }
  const hasGroup = typeof body?.groupId === 'string' && body.groupId && typeof body.groupKey === 'string' && body.groupKey
  if (!hasGroup && body?.allMatching !== true) return []
  if (body?.allMatching && (!body.filter || typeof body.filter !== 'object' || Array.isArray(body.filter))) return []
  if (body?.excludeIds !== undefined && !Array.isArray(body.excludeIds)) return []
  const selectedStatus = body?.filter?.status ?? allowedStatuses[0]
  if (selectedStatus !== 'all' && !allowedStatuses.some(value => value === selectedStatus)) return []
  const filter = parseFailureRecordFilters({ ...body?.filter, status: selectedStatus, ...(hasGroup ? { groupId: body?.groupId, groupKey: body?.groupKey } : {}) })
  if (filter.groupId && !filter.groupKey) return []
  const { where, from, params } = buildFailureRecordQuery(filter)
  const rows = getDb().prepare(`SELECT fr.id ${from} ${where}
    AND fr.status IN (${allowedStatuses.map(() => '?').join(',')})`).all(...params, ...allowedStatuses) as { id: string }[]
  const excluded = new Set(body?.excludeIds || [])
  return rows.map(row => row.id).filter(id => !excluded.has(id))
}
