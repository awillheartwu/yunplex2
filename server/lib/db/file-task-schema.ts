import type Database from 'better-sqlite3'

export interface RunFileTaskAssociation {
  runId: string
  taskId: string
  sourceId: string | null
}

const initializedDatabases = new WeakSet<object>()

/**
 * Caller-owned projections for shared file tasks.
 *
 * This table deliberately does not change download_tasks ownership. A single
 * task may therefore be projected into several manual, repair, or convergence
 * runs after idempotent reuse.
 */
export function createFileTaskSchema(db: Database.Database): void {
  if (initializedDatabases.has(db)) return
  const wasInTransaction = db.inTransaction

  db.transaction(() => {
    const existing = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'run_file_tasks'
    `).get() as { name: string } | undefined
    const foreignKeys = existing
      ? db.pragma('foreign_key_list(run_file_tasks)') as Array<{ table: string; from: string }>
      : []
    const hasLifecycleForeignKeys = foreignKeys.some(key => key.table === 'task_runs' && key.from === 'run_id')
      && foreignKeys.some(key => key.table === 'download_tasks' && key.from === 'task_id')

    if (existing && !hasLifecycleForeignKeys) {
      db.exec(`
        DROP INDEX IF EXISTS idx_run_file_tasks_task;
        DROP INDEX IF EXISTS idx_run_file_tasks_source;
        ALTER TABLE run_file_tasks RENAME TO run_file_tasks_legacy;
      `)
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS run_file_tasks (
        run_id    TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        task_id   TEXT NOT NULL REFERENCES download_tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        source_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id)
      );

      CREATE INDEX IF NOT EXISTS idx_run_file_tasks_task
        ON run_file_tasks(task_id, run_id);
      CREATE INDEX IF NOT EXISTS idx_run_file_tasks_source
        ON run_file_tasks(source_id, run_id);

      CREATE TABLE IF NOT EXISTS download_queue_control (
        id INTEGER PRIMARY KEY CHECK(id=1),
        pause_reason TEXT,
        message TEXT,
        cooldown_until TEXT
      );
    `)

    const taskColumns = new Set((db.prepare('PRAGMA table_info(download_tasks)').all() as Array<{ name: string }>).map(row => row.name))
    for (const [name, definition] of Object.entries({ auto_retry_count: 'INTEGER NOT NULL DEFAULT 0', next_attempt_at: 'TEXT' })) {
      if (!taskColumns.has(name)) db.exec(`ALTER TABLE download_tasks ADD COLUMN ${name} ${definition}`)
    }
    const linkColumns = db.prepare('PRAGMA table_info(run_file_tasks)').all() as Array<{ name: string }>
    if (!linkColumns.some(column => column.name === 'paused')) db.exec('ALTER TABLE run_file_tasks ADD COLUMN paused INTEGER NOT NULL DEFAULT 0')
    if (taskColumns.has('status') && taskColumns.has('created_at')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_download_tasks_ready ON download_tasks(status,next_attempt_at,created_at)')
    }

    if (existing && !hasLifecycleForeignKeys) {
      db.exec(`
        INSERT OR IGNORE INTO run_file_tasks (run_id, task_id, source_id, created_at)
        SELECT legacy.run_id, legacy.task_id, legacy.source_id, legacy.created_at
        FROM run_file_tasks_legacy legacy
        WHERE EXISTS (SELECT 1 FROM task_runs run WHERE run.id = legacy.run_id)
          AND EXISTS (SELECT 1 FROM download_tasks task WHERE task.id = legacy.task_id)
      `)
      db.exec('DROP TABLE run_file_tasks_legacy')
    }
  })()
  // A schema created inside the caller's transaction can disappear if that
  // transaction rolls back. Only cache non-transactional initialization.
  if (!wasInTransaction) initializedDatabases.add(db)
}

export function linkRunFileTask(
  db: Database.Database,
  association: RunFileTaskAssociation,
): void {
  createFileTaskSchema(db)
  db.prepare(`
    INSERT INTO run_file_tasks (run_id, task_id, source_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(run_id, task_id) DO UPDATE SET
      source_id = COALESCE(excluded.source_id, run_file_tasks.source_id)
  `).run(
    association.runId,
    association.taskId,
    association.sourceId,
    new Date().toISOString(),
  )
}

export function listRunFileTasks(
  db: Database.Database,
  runId: string,
): RunFileTaskAssociation[] {
  createFileTaskSchema(db)
  return db.prepare(`
    SELECT run_id AS runId, task_id AS taskId, source_id AS sourceId
    FROM run_file_tasks
    WHERE run_id = ?
    ORDER BY created_at ASC, task_id ASC
  `).all(runId) as RunFileTaskAssociation[]
}

export function listFileTaskRuns(
  db: Database.Database,
  taskId: string,
): RunFileTaskAssociation[] {
  createFileTaskSchema(db)
  return db.prepare(`
    SELECT run_id AS runId, task_id AS taskId, source_id AS sourceId
    FROM run_file_tasks
    WHERE task_id = ?
    ORDER BY created_at ASC, run_id ASC
  `).all(taskId) as RunFileTaskAssociation[]
}
