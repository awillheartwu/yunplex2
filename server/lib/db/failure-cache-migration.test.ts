import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createSchema } from './schema'
import { retirePlaylistSourceFailureCaches } from './migrations'

describe('playlist source failure cache retirement', () => {
  it('migrates legacy source policy into failure records before dropping columns', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys = ON')
      createSchema(db)
      db.prepare('ALTER TABLE playlist_sources ADD COLUMN copyright_restricted_ids TEXT').run()
      db.prepare('ALTER TABLE playlist_sources ADD COLUMN ignored_failure_ids TEXT').run()
      db.prepare(`
        INSERT INTO playlist_sources (
          id, netease_playlist_id, name, netease_playlist_name,
          copyright_restricted_ids, ignored_failure_ids, created_at, updated_at
        ) VALUES ('source-one', 1, 'Source', 'Source', '[42]', ?, ?, ?)
      `).run(JSON.stringify({
        43: {
          count: 3,
          lastStatus: 'failed_tags',
          lastMessage: 'tag failed',
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      }), '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
      db.prepare(`
        INSERT INTO playlist_source_track_occurrences (
          id, source_id, netease_song_id, occurrence, position, title,
          artists_json, metadata_complete, membership_status,
          first_observed_at, last_observed_at
        ) VALUES
          ('source-one:42:0', 'source-one', 42, 0, 0, 'Restricted', '["Artist A"]', 1, 'current', ?, ?),
          ('source-one:43:0', 'source-one', 43, 0, 1, 'Tag Failure', '["Artist B"]', 1, 'current', ?, ?)
      `).run(
        '2026-08-01T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z',
      )

      retirePlaylistSourceFailureCaches(db)
      retirePlaylistSourceFailureCaches(db)

      const columns = db.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).not.toContain('copyright_restricted_ids')
      expect(columns.map(column => column.name)).not.toContain('ignored_failure_ids')
      expect(db.prepare(`
        SELECT song_id, song_name, artist, failure_kind, occurrence_count, status
        FROM failure_records
        ORDER BY song_id
      `).all()).toEqual([
        {
          song_id: 42,
          song_name: 'Restricted',
          artist: 'Artist A',
          failure_kind: 'copyright_restricted',
          occurrence_count: 1,
          status: 'open',
        },
        {
          song_id: 43,
          song_name: 'Tag Failure',
          artist: 'Artist B',
          failure_kind: 'failed_tags',
          occurrence_count: 3,
          status: 'open',
        },
      ])
      expect(db.prepare('SELECT COUNT(*) AS count FROM failure_occurrences').get()).toEqual({ count: 2 })
    } finally {
      db.close()
    }
  })
})
