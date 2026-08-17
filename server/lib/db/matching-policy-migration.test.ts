import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createSchema } from './schema'
import {
  ensureDownloadWhenMediaMissingOverride,
  ensureNullableSourceSyncOverrides,
  retireWeakMetadataBindingsAndLookupCache,
} from './migrations'

const databases: Database.Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function database(): Database.Database {
  const db = new Database(':memory:')
  databases.push(db)
  createSchema(db)
  return db
}

function makeLegacyBooleanColumn(db: Database.Database, column: string, value: 0 | 1): void {
  const nullable = `${column}_nullable_test`
  db.prepare(`ALTER TABLE playlist_sources RENAME COLUMN ${column} TO ${nullable}`).run()
  db.prepare(`ALTER TABLE playlist_sources ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`).run()
  db.prepare(`UPDATE playlist_sources SET ${column} = ?`).run(value)
  db.prepare(`ALTER TABLE playlist_sources DROP COLUMN ${nullable}`).run()
}

describe('matching policy migration', () => {
  it('adds a nullable missing-media override idempotently', () => {
    const db = database()
    db.prepare('ALTER TABLE playlist_sources DROP COLUMN download_when_media_missing').run()

    ensureDownloadWhenMediaMissingOverride(db)
    ensureDownloadWhenMediaMissingOverride(db)

    const column = (db.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{
      name: string
      notnull: number
    }>).find(item => item.name === 'download_when_media_missing')
    expect(column).toMatchObject({ name: 'download_when_media_missing', notnull: 0 })
  })

  it('converts historical one-way booleans to nullable overrides and is repeatable', () => {
    const db = database()
    db.prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, created_at, updated_at)
      VALUES ('source-1', 1, '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z')
    `).run()
    makeLegacyBooleanColumn(db, 'force_full_compare', 1)
    makeLegacyBooleanColumn(db, 'skip_plex_playlist', 0)
    makeLegacyBooleanColumn(db, 'skip_remove_extra_tracks', 0)

    ensureNullableSourceSyncOverrides(db)
    ensureNullableSourceSyncOverrides(db)

    expect(db.prepare(`
      SELECT force_full_compare, skip_plex_playlist, skip_remove_extra_tracks
      FROM playlist_sources WHERE id = 'source-1'
    `).get()).toEqual({
      force_full_compare: 1,
      skip_plex_playlist: null,
      skip_remove_extra_tracks: null,
    })
    const columns = db.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string; notnull: number }>
    expect(columns.filter(column => [
      'force_full_compare',
      'skip_plex_playlist',
      'skip_remove_extra_tracks',
    ].includes(column.name)).every(column => column.notnull === 0)).toBe(true)
  })

  it('stales metadata identities and drops the obsolete lookup table', () => {
    const db = database()
    db.exec(`
      CREATE TABLE song_lookup (
        netease_song_id INTEGER PRIMARY KEY,
        plex_rating_key TEXT,
        file_path TEXT,
        last_verified_at TEXT NOT NULL
      );
      INSERT INTO song_lookup VALUES (7, 'rk-7', '/music/7.flac', '2026-07-26T00:00:00.000Z');
      INSERT INTO song_identity_bindings (
        netease_song_id, plex_file_path, binding_method, status,
        evidence_json, created_at, updated_at
      ) VALUES (
        7, '/music/7.flac', 'metadata', 'active',
        '{}', '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
      );
    `)

    retireWeakMetadataBindingsAndLookupCache(db)
    retireWeakMetadataBindingsAndLookupCache(db)

    expect(db.prepare('SELECT status FROM song_identity_bindings WHERE netease_song_id = 7').get())
      .toEqual({ status: 'stale' })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'song_lookup'").get())
      .toBeUndefined()
  })
})
