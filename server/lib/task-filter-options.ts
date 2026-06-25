import { getDb } from './db'

export interface TaskSourceOption {
  id: string
  name: string
  deleted: boolean
}

export function listTaskSourceOptions(): TaskSourceOption[] {
  const rows = getDb().prepare(`
    WITH source_ids AS (
      SELECT id AS source_id FROM playlist_sources
      UNION
      SELECT source_id FROM task_run_sources WHERE source_id IS NOT NULL
      UNION
      SELECT source_id FROM failure_records WHERE source_id IS NOT NULL
    )
    SELECT
      ids.source_id AS id,
      COALESCE(
        NULLIF(ps.name, ''),
        NULLIF(ps.netease_playlist_name, ''),
        (
          SELECT NULLIF(fr.source_name, fr.source_id)
          FROM failure_records fr
          WHERE fr.source_id = ids.source_id
            AND fr.source_name != ''
          ORDER BY fr.last_seen_at DESC
          LIMIT 1
        ),
        ids.source_id
      ) AS name,
      CASE WHEN ps.id IS NULL THEN 1 ELSE 0 END AS deleted
    FROM source_ids ids
    LEFT JOIN playlist_sources ps ON ps.id = ids.source_id
    ORDER BY deleted ASC, name COLLATE NOCASE ASC
  `).all() as Array<{ id: string; name: string; deleted: number }>

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    deleted: row.deleted === 1,
  }))
}
