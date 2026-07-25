import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import {
  buildExtraTrackObservationKey,
  getExtraTrackObservationCounts,
  markExtraTrackObservationsRemoved,
  observeExtraTracks,
} from './extra-track-observation-store'

const tempDirs: string[] = []

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-extra-observation-'))
  tempDirs.push(dir)
  const now = new Date().toISOString()
  const db = initDb(dir)
  db.prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, created_at, updated_at)
    VALUES ('source', 1, ?, ?)
  `).run(now, now)
}

describe('playlist extra observations', () => {
  afterEach(() => {
    closeDb()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('uses a normalized Plex path as the durable observation identity', () => {
    expect(buildExtraTrackObservationKey('14370', ['/volume1/music/Artist/../Artist/Old.flac']))
      .toBe('path:/volume1/music/Artist/Old.flac')
    expect(buildExtraTrackObservationKey('14370', [])).toBe('rating:14370')
  })

  it('increments only across distinct complete runs and resets after absence', () => {
    setupDb()
    const item = { identityKey: 'path:/music/old.flac', ratingKey: 'old', plexFilePath: '/music/old.flac' }

    expect(observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-1', targetComplete: true, items: [item],
    }).get(item.identityKey)).toBe(1)
    expect(observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-1', targetComplete: true, items: [item],
    }).get(item.identityKey)).toBe(1)
    expect(observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-2', targetComplete: true, items: [item],
    }).get(item.identityKey)).toBe(2)

    observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-3', targetComplete: true, items: [],
    })
    expect(observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-4', targetComplete: true, items: [item],
    }).get(item.identityKey)).toBe(1)
  })

  it('does not accumulate evidence from incomplete target snapshots', () => {
    setupDb()
    const item = { identityKey: 'rating:old', ratingKey: 'old', plexFilePath: null }
    observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-1', targetComplete: true, items: [item],
    })
    const incomplete = observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-2', targetComplete: false, items: [item],
    })

    expect(incomplete.get(item.identityKey)).toBe(0)
    expect(observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-3', targetComplete: true, items: [item],
    }).get(item.identityKey)).toBe(1)
  })

  it('persists removal outcome without treating it as another observation', () => {
    setupDb()
    const item = { identityKey: 'rating:old', ratingKey: 'old', plexFilePath: null }
    observeExtraTracks({
      sourceId: 'source', playlistRatingKey: 'playlist', runId: 'run-1', targetComplete: true, items: [item],
    })
    markExtraTrackObservationsRemoved('source', 'playlist', 'run-1', [item.identityKey])

    expect(getExtraTrackObservationCounts('source', 'playlist').get(item.identityKey)).toBe(0)
  })

  it('cascades observation history when its sync source is deleted', () => {
    setupDb()
    observeExtraTracks({
      sourceId: 'source',
      playlistRatingKey: 'playlist',
      runId: 'run-1',
      targetComplete: true,
      items: [{ identityKey: 'rating:old', ratingKey: 'old', plexFilePath: null }],
    })

    getDb().prepare("DELETE FROM playlist_sources WHERE id = 'source'").run()

    expect(getExtraTrackObservationCounts('source', 'playlist').size).toBe(0)
  })
})
