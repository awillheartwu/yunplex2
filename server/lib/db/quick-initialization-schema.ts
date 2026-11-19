import type Database from 'better-sqlite3'
export function upgradeQuickInitialization(db: Database.Database): void {
  const columns = new Set((db.prepare('PRAGMA table_info(source_initializations)').all() as Array<{name:string}>).map(row=>row.name))
  for (const [name,type] of Object.entries({revision:'INTEGER NOT NULL DEFAULT 0',quick_threshold:'INTEGER',quick_operation_id:'TEXT',score_version:'INTEGER'})) {
    if (!columns.has(name)) db.exec(`ALTER TABLE source_initializations ADD COLUMN ${name} ${type}`)
  }
  const hasItems = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_initialization_items'").get())
  db.exec(`CREATE TABLE IF NOT EXISTS media_corrections (id TEXT PRIMARY KEY,song_id INTEGER NOT NULL,expected_version TEXT,old_binding_json TEXT NOT NULL,old_asset_json TEXT NOT NULL,staged_asset_json TEXT,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_media_correction_active ON media_corrections(song_id) WHERE status IN ('pending','ready');
  CREATE TABLE IF NOT EXISTS initialization_quick_operations (
    id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, initialization_id TEXT NOT NULL REFERENCES source_initializations(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, threshold INTEGER NOT NULL, fingerprint TEXT NOT NULL, bindings_json TEXT NOT NULL,
    plan_json TEXT NOT NULL, previous_json TEXT, status TEXT NOT NULL DEFAULT 'preview', request_id TEXT,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, applied_revision INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_quick_initialization ON initialization_quick_operations(initialization_id,created_at);
  `)
  if (!hasItems) return
  db.exec(`CREATE TRIGGER IF NOT EXISTS init_revision_insert AFTER INSERT ON source_initialization_items BEGIN
    UPDATE source_initializations SET revision=revision+1 WHERE id=NEW.initialization_id; END;
  CREATE TRIGGER IF NOT EXISTS init_revision_update AFTER UPDATE ON source_initialization_items BEGIN
    UPDATE source_initializations SET revision=revision+1 WHERE id=NEW.initialization_id; END;
  CREATE TRIGGER IF NOT EXISTS init_revision_delete AFTER DELETE ON source_initialization_items BEGIN
    UPDATE source_initializations SET revision=revision+1 WHERE id=OLD.initialization_id; END;`)
}
