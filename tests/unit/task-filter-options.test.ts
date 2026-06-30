import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, initDb } from '../../server/lib/db'
import { listTaskSourceOptions } from '../../server/lib/task-filter-options'

const directories: string[] = []

describe('task filter source options', () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('combines current and historical sources and marks deleted sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reyunplex-filter-options-'))
    directories.push(directory)
    initDb(directory)
    const db = getDb()
    const now = '2026-06-22T00:00:00.000Z'
    db.prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, netease_playlist_name, created_at, updated_at
      ) VALUES ('current', 1, '当前歌单任务', '当前歌单', ?, ?)
    `).run(now, now)
    db.prepare(`
      INSERT INTO failure_records (
        id, fingerprint, subject_key, song_name, source_id, source_name,
        run_type, failure_kind, status, first_seen_at, last_seen_at
      ) VALUES (
        'failure', 'fingerprint', 'subject', 'Song', 'deleted', '旧歌单任务',
        'sync', 'failed_download', 'open', ?, ?
      )
    `).run(now, now)

    expect(listTaskSourceOptions()).toEqual([
      { id: 'current', name: '当前歌单任务', deleted: false },
      { id: 'deleted', name: '旧歌单任务', deleted: true },
    ])
  })
})
