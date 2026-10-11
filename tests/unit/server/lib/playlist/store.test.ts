import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createSource, deleteSource, listSources } from '~~/server/lib/playlist/store'
import { parsePlaylistSourceFilters } from '~~/server/lib/api-filter-params'

let directory: string | null = null

afterEach(() => {
  closeDb()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('playlist source lifecycle', () => {
  it('filters recorded Plex targets independently of NetEase subscriptions, including blank targets', () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-source-filter-'))
    const db = initDb(directory)
    const insert = db.prepare(`INSERT INTO playlist_sources
      (id, netease_playlist_id, name, subscribed, plex_playlist_rating_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '2026-09-08', '2026-09-08')`)
    insert.run('owned-bound', 1, 'Owned', 0, 'plex-1')
    insert.run('saved-unbound', 2, 'Saved', 1, '')
    insert.run('saved-bound', 3, 'Both', 1, 'plex-3')
    insert.run('blank', 4, 'Blank', 0, '   ')
    insert.run('empty', 5, 'Empty', 0, '')
    const ids = (query: Record<string, string>) => listSources(parsePlaylistSourceFilters(query)).map(source => source.id).sort()
    expect(ids({ hasPlexTarget: '1' })).toEqual(['owned-bound', 'saved-bound'])
    expect(ids({ hasPlexTarget: '0' })).toEqual(['blank', 'empty', 'saved-unbound'])
    expect(ids({ subscribed: '1' })).toEqual(['saved-bound', 'saved-unbound'])
    expect(ids({ subscribed: '1', hasPlexTarget: '1' })).toEqual(['saved-bound'])
    expect(ids({ subscribed: '1', hasPlexTarget: 'false' })).toEqual(['saved-unbound'])
  })
  it('can create a playlist source disabled for source-attributed downloads', async () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-source-store-'))
    initDb(directory)

    const source = await createSource(99, 'cookie', {
      type: 'playlist',
      name: 'Prepared source',
      enabled: false,
    })

    expect(source).toMatchObject({
      neteasePlaylistId: 99,
      neteasePlaylistName: 'Prepared source',
      enabled: false,
    })
  })

  it('deletes failure records and their occurrences with the source', () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-source-store-'))
    const db = initDb(directory)
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source', 1, 'Source', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO failure_records (
        id, fingerprint, subject_key, song_id, song_name, source_id,
        run_type, failure_kind, status, first_seen_at, last_seen_at
      ) VALUES ('failure', 'fingerprint', 'song:1', 1, 'Song', 'source',
        'sync', 'failed_download', 'open', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
      VALUES ('fingerprint', 'run:1', ?)
    `).run(now)

    expect(deleteSource('source')).toBe(true)
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM failure_records').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM failure_occurrences').get()).toEqual({ count: 0 })
  })
})
