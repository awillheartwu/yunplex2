import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from './migrations'
import { createSchema } from './schema'

const databases: Database.Database[] = []
const cursorColumns = [
  'last_observed_plex_fingerprint',
  'last_applied_plex_fingerprint',
  'last_observed_netease_cursor',
  'last_compared_netease_cursor',
  'last_observed_at',
  'last_compared_at',
] as const

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function legacyDatabaseWithSource(): Database.Database {
  const database = new Database(':memory:')
  databases.push(database)
  createSchema(database)
  database.prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, track_id_snapshot, created_at, updated_at
    ) VALUES ('source-1', 123, '[1,2]', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
  `).run()
  for (const column of cursorColumns) {
    database.prepare(`ALTER TABLE playlist_sources DROP COLUMN ${column}`).run()
  }
  return database
}

describe('playlist source sync cursor migration', () => {
  it('repairs an already-versioned database and preserves existing rows', () => {
    const database = legacyDatabaseWithSource()
    database.pragma('user_version = 999')

    runMigrations(database)

    const columns = (database.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>)
      .map(column => column.name)
    expect(columns).toEqual(expect.arrayContaining([...cursorColumns]))
    expect(database.prepare(`
      SELECT id, track_id_snapshot, last_observed_plex_fingerprint
      FROM playlist_sources WHERE id = 'source-1'
    `).get()).toEqual({
      id: 'source-1',
      track_id_snapshot: '[1,2]',
      last_observed_plex_fingerprint: null,
    })
  })

  it('is repeatable and does not overwrite cursor values', () => {
    const database = legacyDatabaseWithSource()
    database.pragma('user_version = 999')
    runMigrations(database)
    database.prepare(`
      UPDATE playlist_sources
      SET last_observed_plex_fingerprint = 'plex-playlist-v1:test',
          last_compared_netease_cursor = 'netease-playlist-v1:test'
      WHERE id = 'source-1'
    `).run()

    runMigrations(database)

    expect(database.prepare(`
      SELECT last_observed_plex_fingerprint, last_compared_netease_cursor
      FROM playlist_sources WHERE id = 'source-1'
    `).get()).toEqual({
      last_observed_plex_fingerprint: 'plex-playlist-v1:test',
      last_compared_netease_cursor: 'netease-playlist-v1:test',
    })
  })
})

describe('playlist extra observation migration', () => {
  it('repairs an already-versioned database and remains repeatable', () => {
    const database = new Database(':memory:')
    databases.push(database)
    createSchema(database)
    database.prepare('DROP TABLE playlist_extra_observations').run()
    database.pragma('user_version = 999')

    runMigrations(database)
    runMigrations(database)

    const table = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'playlist_extra_observations'
    `).get()
    expect(table).toEqual({ name: 'playlist_extra_observations' })
  })
})
