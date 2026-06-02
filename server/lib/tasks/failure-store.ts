import { getDb } from '../db'

export interface AggregatedFailure {
  id: string
  songName: string
  artist: string
  failureKind: string
  failureReason: string
  sourceName: string
  sourceId: string
  taskType: 'sync' | 'manual' | 'repair'
  lastFailedAt: string
  failureCount: number
  neteaseSongId: number | null
  downloadTaskIds: string | null  // comma-separated underlying task IDs for batch operations
}

export interface FailureQueryParams {
  type?: 'sync' | 'manual' | 'repair'
  failureKind?: string
  /** Exclude copyright_restricted items (default: true for blank filter, overridden when failureKind is set) */
  excludeCopyright?: boolean
  sourceId?: string
  page?: number
  limit?: number
  search?: string
}

export interface FailureQueryResult {
  items: AggregatedFailure[]
  total: number
}

const DEFAULT_WINDOW_DAYS = 30
const DEFAULT_LIMIT = 50

export function queryFailures(params: FailureQueryParams = {}): FailureQueryResult {
  const db = getDb()
  const limit = params.limit || DEFAULT_LIMIT
  const page = params.page || 1
  const offset = (page - 1) * limit
  const windowDays = DEFAULT_WINDOW_DAYS

  // Build WHERE clauses
  const conditions: string[] = []
  const bindParams: unknown[] = []

  // Time window
  conditions.push(`f.created_at > datetime('now', '-${windowDays} days')`)

  // Type filter
  if (params.type) {
    conditions.push('f.task_type = ?')
    bindParams.push(params.type)
  }

  // Failure kind filter
  if (params.failureKind) {
    conditions.push('f.failure_kind = ?')
    bindParams.push(params.failureKind)
  } else if (params.excludeCopyright !== false) {
    // Default: exclude copyright_restricted from "actionable" view
    conditions.push("f.failure_kind != 'copyright_restricted'")
  }

  // Source filter
  if (params.sourceId) {
    conditions.push('f.source_id = ?')
    bindParams.push(params.sourceId)
  }

  // Search
  if (params.search) {
    conditions.push('(f.song_name LIKE ? OR f.artist LIKE ?)')
    const searchTerm = `%${params.search}%`
    bindParams.push(searchTerm, searchTerm)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Build the aggregated query: UNION ALL download_tasks + jobs.songs, then GROUP BY
  const sql = `
    WITH failures AS (
      -- Download task failures (manual/repair downloads)
      SELECT
        dt.id as download_task_id,
        dt.song_id as netease_song_id,
        dt.song_name,
        dt.artist,
        CASE
          WHEN dt.error LIKE '%copyright%' OR dt.error LIKE '%版权%' THEN 'copyright_restricted'
          WHEN dt.error LIKE '%metadata%' OR dt.error LIKE '%tag%' THEN 'metadata_failed'
          ELSE 'download_failed'
        END as failure_kind,
        dt.error as failure_reason,
        COALESCE(ps.name, '手动下载') as source_name,
        dt.source_id,
        'manual' as task_type,
        dt.created_at
      FROM download_tasks dt
      LEFT JOIN playlist_sources ps ON ps.id = dt.source_id
      WHERE dt.status = 'failed'

      UNION ALL

      -- Sync job song failures: extract from jobs.data JSON
      SELECT
        NULL as download_task_id,
        s.json_song_id as netease_song_id,
        s.json_song_name as song_name,
        s.json_artist as artist,
        s.json_status as failure_kind,
        s.json_error as failure_reason,
        COALESCE(ps.name, '同步任务') as source_name,
        j.source as source_id,
        'sync' as task_type,
        j.started_at as created_at
      FROM jobs j
      JOIN (
        SELECT
          j2.id as job_id,
          json_extract(s2.value, '$.songId') as json_song_id,
          json_extract(s2.value, '$.songName') as json_song_name,
          json_extract(s2.value, '$.artist') as json_artist,
          json_extract(s2.value, '$.status') as json_status,
          json_extract(s2.value, '$.error') as json_error
        FROM jobs j2, json_each(j2.data, '$.songs') s2
      ) s ON s.job_id = j.id
      LEFT JOIN playlist_sources ps ON ps.id = j.source
      WHERE j.status IN ('partial', 'failed')
        AND s.json_status IN ('failed', 'ignored_failure', 'copyright_restricted')
    )
    SELECT
      -- Stable composite ID: group key fields concatenated
      song_name || '|' || artist || '|' || failure_kind || '|' || source_id as id,
      song_name,
      artist,
      failure_kind,
      failure_reason,
      source_name,
      source_id,
      task_type,
      MAX(created_at) as last_failed_at,
      COUNT(*) as failure_count,
      MAX(netease_song_id) as netease_song_id,
      group_concat(download_task_id) as download_task_ids
    FROM failures f
    ${whereClause}
    GROUP BY song_name, artist, failure_kind, source_id
    ORDER BY last_failed_at DESC
    LIMIT ? OFFSET ?
  `

  bindParams.push(limit, offset)

  let items: AggregatedFailure[]
  try {
    items = db.prepare(sql).all(...bindParams) as AggregatedFailure[]
  } catch (err) {
    console.error('[failure-store] query error:', err)
    return { items: [], total: 0 }
  }

  // Count total
  const countSql = `
    WITH failures AS (
      SELECT dt.song_name, dt.artist,
        CASE WHEN dt.error LIKE '%copyright%' OR dt.error LIKE '%版权%' THEN 'copyright_restricted'
             WHEN dt.error LIKE '%metadata%' OR dt.error LIKE '%tag%' THEN 'metadata_failed'
             ELSE 'download_failed' END as failure_kind,
        dt.source_id,
        dt.created_at,
        CASE
          WHEN EXISTS (SELECT 1 FROM jobs j2 WHERE j2.id = dt.job_id AND j2.source = 'repair') THEN 'repair'
          ELSE 'manual'
        END as task_type
      FROM download_tasks dt
      WHERE dt.status = 'failed'
      UNION ALL
      SELECT s.json_song_name as song_name,
             s.json_artist as artist,
             s.json_status as failure_kind,
             j.source as source_id,
             j.started_at as created_at,
             'sync' as task_type
      FROM jobs j
      JOIN (
        SELECT j2.id as job_id,
               json_extract(s2.value, '$.songName') as json_song_name,
               json_extract(s2.value, '$.artist') as json_artist,
               json_extract(s2.value, '$.status') as json_status
        FROM jobs j2, json_each(j2.data, '$.songs') s2
      ) s ON s.job_id = j.id
      WHERE j.status IN ('partial', 'failed')
        AND s.json_status IN ('failed', 'ignored_failure', 'copyright_restricted')
    )
    SELECT COUNT(DISTINCT song_name || '|' || artist || '|' || failure_kind || '|' || source_id) as total
    FROM failures f
    ${whereClause}
  `

  const totalParams = bindParams.slice(0, -2)  // remove limit/offset
  let total = 0
  try {
    const countResult = db.prepare(countSql).get(...totalParams) as { total: number }
    total = countResult?.total || 0
  } catch (err) {
    console.error('[failure-store] count error:', err)
  }

  return { items, total }
}

/**
 * Resolve composite failure IDs to individual download_task IDs.
 * Re-runs the aggregation query with an id filter, extracting download_task_ids from group_concat.
 */
export function resolveCompositeIds(compositeIds: string[]): string[] {
  if (compositeIds.length === 0) return []

  const db = getDb()
  const placeholders = compositeIds.map(() => '?').join(',')

  const rows = db.prepare(`
    WITH failures AS (
      SELECT
        dt.id as download_task_id,
        dt.song_name, dt.artist,
        CASE
          WHEN dt.error LIKE '%copyright%' OR dt.error LIKE '%版权%' THEN 'copyright_restricted'
          WHEN dt.error LIKE '%metadata%' OR dt.error LIKE '%tag%' THEN 'metadata_failed'
          ELSE 'download_failed'
        END as failure_kind,
        dt.source_id
      FROM download_tasks dt
      WHERE dt.status = 'failed'
    )
    SELECT group_concat(download_task_id) as ids
    FROM failures
    WHERE (song_name || '|' || artist || '|' || failure_kind || '|' || source_id) IN (${placeholders})
    GROUP BY song_name, artist, failure_kind, source_id
  `).all(...compositeIds) as { ids: string | null }[]

  const taskIds: string[] = []
  for (const row of rows) {
    if (row.ids) {
      for (const id of row.ids.split(',')) {
        if (id && !taskIds.includes(id)) taskIds.push(id)
      }
    }
  }
  return taskIds
}
