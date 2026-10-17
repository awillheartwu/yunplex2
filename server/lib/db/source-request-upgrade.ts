import { upgradeQuickInitialization } from './quick-initialization-schema'
import type Database from 'better-sqlite3'

/** Bounded, repeatable upgrade of the pre-release source request schema. */
export function upgradeSourceRequests(db: Database.Database): void {
  db.transaction(() => {
    const add = (table: string, additions: Record<string, string>) => {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name))
      for (const [name, definition] of Object.entries(additions)) {
        if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
      }
    }
    add('source_sync_queue', {
      request_kind: "TEXT NOT NULL DEFAULT 'convergence'",
      mode: "TEXT NOT NULL DEFAULT 'normal'", trigger: "TEXT NOT NULL DEFAULT 'schedule'",
      batch_id: 'TEXT', batch_position: 'INTEGER NOT NULL DEFAULT 0',
      initialization_id: 'TEXT', follow_up_of: 'TEXT',
      cancel_requested_at: 'TEXT',
      allow_disabled: 'INTEGER NOT NULL DEFAULT 0', take_over_external: 'INTEGER NOT NULL DEFAULT 0',
      plex_recovery_json: 'TEXT',
    })
    add('source_initializations', { rule_version: 'INTEGER NOT NULL DEFAULT 0', commit_result_json: 'TEXT', matching_config_json: 'TEXT', matching_config_fingerprint: 'TEXT', matching_data_fingerprint: 'TEXT', auto_process: 'INTEGER NOT NULL DEFAULT 0', reevaluate_automatic: 'INTEGER NOT NULL DEFAULT 0' })
    upgradeQuickInitialization(db)
    db.exec(`
      UPDATE source_sync_queue SET trigger='user' WHERE schedule_window LIKE 'manual:%' AND trigger='schedule' AND request_kind='convergence';
      DROP INDEX IF EXISTS idx_source_request_initialization;
      CREATE UNIQUE INDEX idx_source_request_initialization
        ON source_sync_queue(initialization_id) WHERE request_kind='analysis' AND initialization_id IS NOT NULL;
      UPDATE source_sync_queue SET initialization_id=(
        SELECT initialization_id FROM initialization_quick_operations op WHERE op.request_id=source_sync_queue.id
      ) WHERE request_kind='initialization_apply' AND initialization_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_source_request_apply ON source_sync_queue(initialization_id,request_kind,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_request_follow_up
        ON source_sync_queue(follow_up_of) WHERE follow_up_of IS NOT NULL;
    `)
  })()
}
