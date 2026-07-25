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

  it('repairs the mixed legacy artist cache schema even when its historical migration was already marked applied', () => {
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
    const columns = getDb().prepare("PRAGMA table_info('artist_resolution_cache')").all() as Array<{ name: string; pk: number }>
    expect(columns.find(column => column.name === 'normalized_name')?.pk).toBe(1)
    expect(columns.map(column => column.name)).toContain('original_name')
    expect(getDb().prepare('SELECT original_name FROM artist_resolution_cache').get()).toEqual({ original_name: '夏日入侵企画' })
  })

  it('repairs legacy identity and review tables even when the database version is already ahead', () => {
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
    const reviewColumns = getDb().prepare("PRAGMA table_info('song_match_reviews')").all() as Array<{ name: string }>
    expect(bindingColumns.map(column => column.name)).toContain('plex_relative_path')
    expect(reviewColumns.map(column => column.name)).toEqual(expect.arrayContaining(['candidate_key', 'evidence_type']))
    expect(getDb().prepare('SELECT plex_relative_path FROM song_identity_bindings WHERE netease_song_id = 1').get())
      .toEqual({ plex_relative_path: 'Artist/Album/A.flac' })

    const reviews = getDb().prepare(`
      SELECT id, candidate_key, evidence_type, status FROM song_match_reviews ORDER BY id
    `).all() as Array<{ id: string; candidate_key: string; evidence_type: string; status: string }>
    expect(new Set(reviews.map(review => review.candidate_key)).size).toBe(1)
    expect(reviews.every(review => review.candidate_key.length === 64)).toBe(true)
    expect(reviews.every(review => review.evidence_type === 'metadata')).toBe(true)
    expect(reviews.filter(review => review.status === 'pending')).toHaveLength(1)
    expect(reviews.filter(review => review.status === 'superseded')).toHaveLength(1)

    const kept = reviews.find(review => review.status === 'pending')!
    const occurrences = getDb().prepare(`
      SELECT source_id, run_id FROM song_match_review_occurrences
      WHERE review_id = ? ORDER BY source_id
    `).all(kept.id)
    expect(occurrences).toEqual([
      { source_id: 'source-a', run_id: 'run-a' },
      { source_id: 'source-b', run_id: 'run-b' },
    ])
  })

  it('upgrades the MusicBrainz recording cache status constraint without losing rows', () => {
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

    expect(getDb().prepare('SELECT lookup_key, last_status FROM musicbrainz_recording_cache').all())
      .toEqual([{ lookup_key: 'existing', last_status: 'success' }])
    expect(() => getDb().prepare(`
      INSERT INTO musicbrainz_recording_cache VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('ambiguous', '{"status":"ambiguous"}', 'ambiguous', 95, 0, null, '2026-07-13T00:00:00.000Z'))
      .not.toThrow()
  })

  it('creates the typed MusicBrainz ID mapping cache even when user_version is already ahead', () => {
    const dir = createTempDataDir()
    const legacyDb = new Database(join(dir, 'data.db'))
    legacyDb.exec('PRAGMA user_version = 999;')
    legacyDb.close()

    initDb(dir)

    const table = getDb().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'musicbrainz_id_mapping_cache'
    `).get()
    expect(table).toEqual({ name: 'musicbrainz_id_mapping_cache' })
    expect(() => getDb().prepare(`
      INSERT INTO musicbrainz_id_mapping_cache (
        input_mbid, resolved_json, entity_type, status, recording_id,
        failure_count, last_attempt_at, updated_at
      ) VALUES (?, ?, 'release_track', 'success', ?, 0, ?, ?)
    `).run(
      '8220c472-146e-4a9e-a71e-fd8beb603e14',
      '{"status":"success"}',
      '1cdb1f16-31e5-4765-af6e-c3c02386dcc4',
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z',
    )).not.toThrow()
  })

  it('adds the metadata binding method without losing established identities', () => {
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
    )).not.toThrow()
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
})
