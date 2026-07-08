import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'

const tempDirs: string[] = []

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-db-migration-'))
  tempDirs.push(dir)
  return dir
}

describe('database migrations', () => {
  it('repairs an existing database whose version advanced before idempotency columns were added', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE download_tasks (
        id              TEXT PRIMARY KEY,
        source_id       TEXT,
        song_id         INTEGER NOT NULL,
        song_name       TEXT NOT NULL,
        artist          TEXT NOT NULL DEFAULT '',
        album           TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','downloading','tagging','done','failed')),
        progress        INTEGER NOT NULL DEFAULT 0,
        file_path       TEXT,
        file_type       TEXT,
        quality         TEXT,
        error           TEXT,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        job_id          TEXT,
        run_id          TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      PRAGMA user_version = 32;
    `)
    legacyDb.close()

    initDb(dir)

    const columns = getDb().prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
      'idempotency_key',
      'lease_owner',
      'lease_expires_at',
      'attempt_started_at',
    ]))

    const index = getDb().prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_download_tasks_active_idempotency'
    `).get() as { name: string } | undefined
    expect(index?.name).toBe('idx_download_tasks_active_idempotency')
  })
})
