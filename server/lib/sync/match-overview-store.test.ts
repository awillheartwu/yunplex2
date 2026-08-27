import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { upsertSongIdentityBinding } from './identity-store'
import { queryMatchOverview } from './match-management-store'

const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-overview-'))
  dirs.push(dir)
  initDb(dir)
  const now = '2026-08-23T00:00:00.000Z'
  getDb().prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
    VALUES ('source-one', 1, '歌单一', ?, ?)
  `).run(now, now)
  getDb().prepare(`
    INSERT INTO playlist_source_track_occurrences (
      id, source_id, netease_song_id, occurrence, position, title,
      artists_json, metadata_complete, membership_status,
      first_observed_at, last_observed_at
    ) VALUES ('source-one:1:0', 'source-one', 1, 0, 0, '当前歌曲', '["歌手"]', 1, 'current', ?, ?)
  `).run(now, now)
}

function bind(songId: number, status: 'active' | 'unbound' = 'active') {
  return upsertSongIdentityBinding({
    neteaseSongId: songId,
    plexSectionKey: '12',
    plexSectionRoot: '/music',
    plexFilePath: `/music/${songId}.flac`,
    plexRatingKey: String(songId),
    bindingMethod: 'manual',
    status,
    evidence: {},
  })
}

afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('match overview read model', () => {
  it('returns current source occurrences with global binding impact', () => {
    setup()
    bind(1)

    const page = queryMatchOverview({ sourceId: 'source-one' })

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      target: { neteaseSongId: 1, title: '当前歌曲' },
      binding: { bindingMethod: 'manual', status: 'active' },
      affectedSources: [{ id: 'source-one', name: '歌单一' }],
    })
  })

  it('shows only active or stale bindings that no current source references', () => {
    setup()
    bind(1)
    bind(2)
    bind(3, 'unbound')

    const page = queryMatchOverview({ sourceId: 'orphaned' })

    expect(page.items.map(item => item.target.neteaseSongId)).toEqual([2])
    expect(page.items[0]?.occurrence).toBeNull()
    expect(page.items[0]?.affectedSources).toEqual([])
  })

  it('exposes an intentional waiting state separately from sync failure', () => {
    setup()
    getDb().prepare(`
      UPDATE playlist_source_track_occurrences
      SET last_song_status = 'awaiting_manual_match'
      WHERE id = 'source-one:1:0'
    `).run()

    const page = queryMatchOverview({ sourceId: 'source-one' })

    expect(page.items[0]?.state).toBe('awaiting_manual')
  })
})
