import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import { repairMediaIdentityData } from '../../server/lib/db/migrations'

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
  it('advances a fresh database to the complete schema without skipping required columns', () => {
    const dir = createTempDataDir()

    initDb(dir)

    const version = getDb().prepare('PRAGMA user_version').get() as { user_version: number }
    const downloadColumns = getDb().prepare("PRAGMA table_info('download_tasks')").all() as Array<{ name: string }>
    const runColumns = getDb().prepare("PRAGMA table_info('task_runs')").all() as Array<{ name: string }>
    const changeTable = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_run_song_changes'").get()
    expect(version.user_version).toBe(50)
    expect(runColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'dry_run',
      'details_expired',
      'steps_json',
    ]))
    expect(runColumns.map(column => column.name)).not.toContain('data')
    expect(changeTable).toBeDefined()
    expect(downloadColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'run_id',
      'idempotency_key',
      'lease_owner',
    ]))
  })

  it('drops legacy run snapshots without translating their song detail', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'system',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        total_items INTEGER NOT NULL DEFAULT 0,
        success_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        skipped_items INTEGER NOT NULL DEFAULT 0,
        removed_items INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '',
        target TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO task_runs (
        id, type, trigger, started_at, finished_at, status, summary,
        total_items, success_items, failed_items, skipped_items, removed_items,
        warnings, source, target, duration_ms, data
      ) VALUES (
        'legacy-json', 'sync', 'system', '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:01:00.000Z', 'partial', '旧运行', 2, 0, 1, 1, 0,
        0, '网易云音乐', 'Plex', 60000,
        '{"dryRun":true,"songs":[{"id":"old-song","status":"failed_download"}]}'
      );
      PRAGMA user_version = 49;
    `)
    legacyDb.close()

    initDb(dir)

    const columns = getDb().prepare("PRAGMA table_info('task_runs')").all() as Array<{ name: string }>
    expect(columns.map(column => column.name)).not.toContain('data')
    expect(getDb().prepare(`
      SELECT dry_run, details_expired, steps_json FROM task_runs WHERE id = 'legacy-json'
    `).get()).toEqual({ dry_run: 1, details_expired: 1, steps_json: '[]' })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task_run_song_changes').get()).toEqual({ count: 0 })
  })

  it('drops the retired activity projection and all stored rows', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        link TEXT,
        group_key TEXT
      );
      INSERT INTO activity_events (
        id, domain, type, severity, occurred_at, actor, title, summary
      ) VALUES (
        'event-1', 'sync', 'sync_completed', 'success',
        '2026-08-01T00:00:00.000Z', 'system', '完成', '旧动态'
      );
      PRAGMA user_version = 46;
    `)
    legacyDb.close()

    initDb(dir)

    expect(getDb().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'activity_events'
    `).get()).toBeUndefined()
  })

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

  it('drops the retired artist resolution cache', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE artist_resolution_cache (
        artist_name TEXT PRIMARY KEY,
        normalized_name TEXT NOT NULL,
        resolved_json TEXT NOT NULL,
        source TEXT, confidence INTEGER, mb_score INTEGER, last_status TEXT,
        failure_count INTEGER, last_attempt_at TEXT, updated_at TEXT NOT NULL
      );
      INSERT INTO artist_resolution_cache VALUES ('夏日入侵企画', '夏日入侵企画', '{"input":"夏日入侵企画","candidates":[]}', 'musicbrainz', 80, 99, 'success', 0, NULL, '2026-07-10T00:00:00.000Z');
      PRAGMA user_version = 34;
    `)
    legacyDb.close()

    initDb(dir)
    expect(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artist_resolution_cache'").get())
      .toBeUndefined()
  })

  it('keeps safe path bindings and retires review tables even when the database version is already ahead', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO config VALUES (
        'app',
        '{"download":{"plexLibraryPathPrefix":"/volume1/06_Music"}}'
      );
      CREATE TABLE song_identity_bindings (
        netease_song_id INTEGER PRIMARY KEY,
        plex_section_key TEXT NOT NULL DEFAULT '',
        plex_file_path TEXT NOT NULL,
        plex_rating_key TEXT,
        mb_recording_id TEXT,
        binding_method TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      INSERT INTO song_identity_bindings VALUES (
        1, '12', '/volume1/06_Music/Artist/Album/A.flac', '10', NULL,
        'path', 'active', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
      );
      CREATE TABLE song_match_reviews (
        id TEXT PRIMARY KEY,
        netease_song_id INTEGER NOT NULL,
        source_id TEXT,
        run_id TEXT,
        candidate_plex_file_path TEXT,
        candidate_plex_rating_key TEXT,
        candidate_mb_recording_id TEXT,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      INSERT INTO song_match_reviews VALUES
        ('old-a', 1, 'source-a', 'run-a', '/volume1/06_Music/Artist/Album/A.flac', '10', NULL, '{"reason":"metadata"}', 'pending', NULL, '2026-01-01T00:00:00.000Z', NULL),
        ('old-b', 1, 'source-b', 'run-b', '/volume1/06_Music/Artist/Album/A.flac', '10', NULL, '{"reason":"metadata"}', 'pending', NULL, '2026-01-02T00:00:00.000Z', NULL);
      PRAGMA user_version = 999;
    `)
    legacyDb.close()

    initDb(dir)

    const bindingColumns = getDb().prepare("PRAGMA table_info('song_identity_bindings')").all() as Array<{ name: string }>
    expect(bindingColumns.map(column => column.name)).toContain('plex_relative_path')
    expect(getDb().prepare('SELECT binding_method FROM song_identity_bindings WHERE netease_song_id = 1').get())
      .toEqual({ binding_method: 'path' })
    expect(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'song_match_reviews'").get())
      .toBeUndefined()
  })

  it('drops the retired MusicBrainz recording cache', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE musicbrainz_recording_cache (
        lookup_key TEXT PRIMARY KEY,
        resolved_json TEXT NOT NULL,
        last_status TEXT NOT NULL CHECK(last_status IN ('success','empty','failed','disabled')),
        score INTEGER,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO musicbrainz_recording_cache VALUES (
        'existing', '{"status":"success","id":"recording-1"}', 'success', 99, 0, NULL,
        '2026-07-13T00:00:00.000Z'
      );
      PRAGMA user_version = 999;
    `)
    legacyDb.close()

    initDb(dir)

    expect(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'musicbrainz_recording_cache'").get())
      .toBeUndefined()
  })

  it('does not recreate the retired MusicBrainz ID mapping cache', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec('PRAGMA user_version = 999;')
    legacyDb.close()

    initDb(dir)

    const table = getDb().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'musicbrainz_id_mapping_cache'
    `).get()
    expect(table).toBeUndefined()
  })

  it('keeps path bindings and rejects retired metadata bindings', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE song_identity_bindings (
        netease_song_id INTEGER PRIMARY KEY,
        plex_section_key TEXT NOT NULL DEFAULT '',
        plex_file_path TEXT NOT NULL,
        plex_relative_path TEXT NOT NULL DEFAULT '',
        plex_rating_key TEXT,
        mb_recording_id TEXT,
        binding_method TEXT NOT NULL CHECK(binding_method IN ('path','mb_recording','manual','migrated')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stale','unbound')),
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      INSERT INTO song_identity_bindings VALUES (
        1, '12', '/volume1/music/existing.flac', 'existing.flac', '10', NULL,
        'path', 'active', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
      );
      PRAGMA user_version = 999;
    `)
    legacyDb.close()

    initDb(dir)

    expect(getDb().prepare('SELECT netease_song_id, binding_method FROM song_identity_bindings').all())
      .toEqual([{ netease_song_id: 1, binding_method: 'path' }])
    expect(() => getDb().prepare(`
      INSERT INTO song_identity_bindings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      2, '12', '/volume1/music/new.flac', 'new.flac', '11', null,
      'metadata', 'active', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null,
    )).toThrow()
  })

  it('classifies historical local media ownership without trusting computed paths', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec(`
      CREATE TABLE local_media_assets (
        netease_song_id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        provenance TEXT NOT NULL,
        source_task_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        file_size INTEGER,
        file_mtime_ms INTEGER,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_verified_at TEXT
      );
      INSERT INTO local_media_assets VALUES
        (1, '/music/downloaded.flac', 'download_task', 'task-1', 'active', 1, 1, '{}', '2026-01-01', '2026-01-01', NULL),
        (2, '/music/computed.flac', 'computed', NULL, 'active', 1, 1, '{}', '2026-01-01', '2026-01-01', NULL),
        (3, '/music/adopted.flac', 'download_task', 'task-3', 'active', 1, 1, '{"audioOperation":"adopted_existing"}', '2026-01-01', '2026-01-01', NULL);
      PRAGMA user_version = 999;
    `)
    legacyDb.close()

    initDb(dir)

    expect(getDb().prepare(`
      SELECT netease_song_id, ownership
      FROM local_media_assets
      ORDER BY netease_song_id
    `).all()).toEqual([
      { netease_song_id: 1, ownership: 'managed' },
      { netease_song_id: 2, ownership: 'external' },
      { netease_song_id: 3, ownership: 'external' },
    ])
  })

  it('repairs malformed identity paths and removes unusable failure rows', () => {
    const dir = createTempDataDir()
    initDb(dir)
    const db = getDb()
    const now = new Date().toISOString()
    const config = JSON.parse((db.prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string }).value)
    config.download.plexLibraryPathPrefix = '/volume1/06_Music'
    db.prepare("UPDATE config SET value = ? WHERE key = 'app'").run(JSON.stringify(config))
    db.prepare(`
      INSERT INTO song_identity_bindings (
        netease_song_id, plex_section_key, plex_file_path, plex_relative_path,
        plex_rating_key, binding_method, status, evidence_json,
        created_at, updated_at, last_verified_at
      ) VALUES (1, '12', '/volume1/06_Music/Artist/Song.flac',
        'volume1/06_Music/Artist/Song.flac', '10', 'manual', 'stale', '{}', ?, ?, ?)
    `).run(now, now, now)
    db.prepare(`
      INSERT INTO failure_records (
        id, fingerprint, subject_key, song_id, song_name, source_id, run_type,
        failure_kind, status, first_seen_at, last_seen_at
      ) VALUES ('orphan', 'orphan-fingerprint', 'song:1', 1, 'Song', 'missing-source',
        'sync', 'failed_download', 'open', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
      VALUES ('orphan-fingerprint', 'run:1', ?)
    `).run(now)

    repairMediaIdentityData(db)

    expect(db.prepare('SELECT plex_relative_path FROM song_identity_bindings WHERE netease_song_id = 1').get())
      .toEqual({ plex_relative_path: 'Artist/Song.flac' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM failure_records').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM failure_occurrences').get()).toEqual({ count: 0 })
  })
})
