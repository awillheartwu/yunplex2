import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import { CURRENT_SCHEMA_VERSION } from '../../server/lib/db/schema'

const tempDirs: string[] = []

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-db-baseline-'))
  tempDirs.push(dir)
  return dir
}

const EXPECTED_TABLES = [
  'app_state',
  'auth_admin',
  'auth_sessions',
  'config',
  'download_tasks',
  'failure_occurrences',
  'failure_records',
  'local_media_assets',
  'logs',
  'playlist_extra_observations',
  'playlist_source_track_occurrences',
  'playlist_sources',
  'song_identity_bindings',
  'source_sync_queue',
  'task_run_song_changes',
  'task_run_sources',
  'task_runs',
] as const

describe('current database schema baseline', () => {
  it('creates exactly the 17 current product tables', () => {
    initDb(createTempDataDir())

    const tables = getDb().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>
    const version = getDb().pragma('user_version', { simple: true }) as number

    expect(tables.map(table => table.name)).toEqual(EXPECTED_TABLES)
    expect(version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('contains the sparse run and current media identity columns only', () => {
    initDb(createTempDataDir())

    const runColumns = getDb().prepare("PRAGMA table_info('task_runs')").all() as Array<{ name: string }>
    const bindingColumns = getDb().prepare("PRAGMA table_info('song_identity_bindings')").all() as Array<{ name: string }>
    const downloadIndexes = getDb().prepare("PRAGMA index_list('download_tasks')").all() as Array<{ name: string }>

    expect(runColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'dry_run',
      'details_expired',
      'steps_json',
    ]))
    expect(runColumns.map(column => column.name)).not.toContain('data')
    expect(bindingColumns.map(column => column.name)).not.toContain('mb_recording_id')
    expect(downloadIndexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_download_tasks_active_idempotency',
      'idx_download_tasks_time',
    ]))
  })

  it('is idempotent and preserves current rows when reopened', () => {
    const dir = createTempDataDir()
    initDb(dir)
    getDb().prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('baseline-test', 'kept')
    closeDb()

    initDb(dir)

    expect(getDb().prepare('SELECT value FROM app_state WHERE key = ?').get('baseline-test'))
      .toEqual({ value: 'kept' })
    expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
