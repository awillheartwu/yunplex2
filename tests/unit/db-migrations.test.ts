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
  'run_file_tasks',
  'song_identity_bindings',
  'source_initialization_items',
  'source_initializations',
  'source_media_decisions',
  'source_sync_queue',
  'task_run_links',
  'task_run_song_changes',
  'task_run_sources',
  'task_runs',
] as const

describe('current database schema baseline', () => {
  it('creates exactly the current product tables', () => {
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
    const downloadColumns = getDb().prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
    const downloadIndexes = getDb().prepare("PRAGMA index_list('download_tasks')").all() as Array<{ name: string }>

    expect(runColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'dry_run',
      'details_expired',
      'steps_json',
    ]))
    expect(runColumns.map(column => column.name)).not.toContain('data')
    expect(bindingColumns.map(column => column.name)).not.toContain('mb_recording_id')
    expect(downloadColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'operation',
      'target_path',
      'execution_intent_json',
    ]))
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

  it('migrates existing playlists to pending initialization while excluding albums', () => {
    const dir = createTempDataDir()
    initDb(dir)
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name, type, created_at, updated_at
    ) VALUES ('playlist-1', 1, 'Playlist', 0, 'Playlist', 'playlist', ?, ?),
             ('album-1', 2, 'Album', 0, 'Album', 'album', ?, ?)`)
      .run(now, now, now, now)
    closeDb()

    initDb(dir)

    expect(getDb().prepare('SELECT source_id, status FROM source_initializations ORDER BY source_id').all())
      .toEqual([{ source_id: 'playlist-1', status: 'pending' }])
  })

  it('repairs preserved initialization items that were incorrectly made actionable', () => {
    const dir = createTempDataDir()
    initDb(dir)
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name, type, created_at, updated_at
    ) VALUES ('playlist-1', 1, 'Playlist', 0, 'Playlist', 'playlist', ?, ?)`).run(now, now)
    getDb().prepare(`INSERT INTO source_initializations (
      id, source_id, status, total_items, preserved_items, adopt_items, download_items, deferred_items, created_at, updated_at
    ) VALUES ('initialization-1', 'playlist-1', 'awaiting_review', 1, 1, 0, 1, 0, ?, ?)`).run(now, now)
    getDb().prepare(`INSERT INTO source_initialization_items (
      initialization_id, netease_song_id, position, tier, decision, decision_status, updated_at
    ) VALUES ('initialization-1', 42, 0, 'preserved', 'download', 'proposed', ?)`).run(now)
    closeDb()

    initDb(dir)

    expect(getDb().prepare(`SELECT decision FROM source_initialization_items WHERE initialization_id='initialization-1'`).get())
      .toEqual({ decision: 'defer' })
    expect(getDb().prepare(`SELECT adopt_items, download_items, deferred_items FROM source_initializations WHERE id='initialization-1'`).get())
      .toEqual({ adopt_items: 0, download_items: 0, deferred_items: 0 })
  })
  it('upgrades the preceding source request structure twice without losing history or completed counts', () => {
    const dir = createTempDataDir()
    initDb(dir)
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO playlist_sources (id,netease_playlist_id,name,enabled,netease_playlist_name,created_at,updated_at)
      VALUES ('old-source',1,'Old',0,'Old',?,?)`).run(now, now)
    db.prepare(`INSERT INTO source_initializations (id,source_id,status,total_items,adopt_items,created_at,updated_at)
      VALUES ('old-draft','old-source','completed',80,72,?,?)`).run(now, now)
    db.prepare(`INSERT INTO source_sync_queue (id,source_id,schedule_window,status,available_at,created_at,updated_at)
      VALUES ('old-request','old-source','manual:old','completed',?,?,?)`).run(now, now, now)
    db.exec('DROP INDEX idx_source_request_initialization; DROP INDEX idx_source_request_follow_up')
    for (const column of ['request_kind','mode','trigger','batch_id','batch_position','initialization_id','follow_up_of','allow_disabled','take_over_external','cancel_requested_at']) {
      db.exec(`ALTER TABLE source_sync_queue DROP COLUMN ${column}`)
    }
    db.exec('ALTER TABLE source_initializations DROP COLUMN rule_version; ALTER TABLE source_initializations DROP COLUMN commit_result_json')
    for (let pass = 0; pass < 2; pass++) {
      closeDb(); initDb(dir)
      expect(getDb().prepare("SELECT id,status,trigger,mode FROM source_sync_queue WHERE id='old-request'").get())
        .toEqual({ id: 'old-request', status: 'completed', trigger: 'user', mode: 'normal' })
      expect(getDb().prepare("SELECT total_items,adopt_items,rule_version FROM source_initializations WHERE id='old-draft'").get())
        .toEqual({ total_items: 80, adopt_items: 72, rule_version: 0 })
      expect(getDb().pragma('integrity_check', { simple: true })).toBe('ok')
    }
  })

})
