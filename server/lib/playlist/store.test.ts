import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { deleteSource } from './store'

let directory: string | null = null

afterEach(() => {
  closeDb()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('playlist source lifecycle', () => {
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
