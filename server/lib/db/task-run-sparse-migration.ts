import type Database from 'better-sqlite3'
import { tableExists } from './introspection'

function hasColumn(d: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(d, tableName)) return false
  return (d.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>)
    .some(column => column.name === columnName)
}

/**
 * Task runs are an audit summary plus sparse changed/exception items. Historical
 * JSON snapshots are intentionally discarded instead of translated.
 */
export function ensureSparseTaskRunSchema(d: Database.Database): void {
  if (!tableExists(d, 'task_runs')) return

  d.transaction(() => {
    if (!hasColumn(d, 'task_runs', 'dry_run')) {
      d.prepare('ALTER TABLE task_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0').run()
    }
    if (!hasColumn(d, 'task_runs', 'details_expired')) {
      d.prepare('ALTER TABLE task_runs ADD COLUMN details_expired INTEGER NOT NULL DEFAULT 0').run()
    }
    if (!hasColumn(d, 'task_runs', 'steps_json')) {
      d.prepare("ALTER TABLE task_runs ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'").run()
    }

    d.exec(`
      CREATE TABLE IF NOT EXISTS task_run_song_changes (
        run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        source_id TEXT,
        netease_song_id INTEGER,
        netease_index INTEGER,
        song_name TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        album TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        file_path TEXT,
        file_type TEXT,
        error_json TEXT,
        metadata_json TEXT,
        ops_json TEXT,
        PRIMARY KEY (run_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_status
        ON task_run_song_changes(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_source
        ON task_run_song_changes(source_id, run_id);
      CREATE INDEX IF NOT EXISTS idx_task_run_song_changes_song
        ON task_run_song_changes(netease_song_id, run_id);
    `)

    if (hasColumn(d, 'task_runs', 'data')) {
      d.prepare(`
        UPDATE task_runs
        SET dry_run = CASE
          WHEN json_valid(data) = 1 THEN COALESCE(json_extract(data, '$.dryRun'), 0)
          ELSE 0
        END,
        details_expired = 1,
        steps_json = '[]'
      `).run()
      d.prepare('ALTER TABLE task_runs DROP COLUMN data').run()
    }
  })()
}
