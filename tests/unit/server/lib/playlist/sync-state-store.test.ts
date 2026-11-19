import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import {
  getSource,
  recordAppliedPlexPlaylistFingerprint,
  recordSourceComparison,
  recordSourceObservation,
} from '~~/server/lib/playlist/store'

const tempDirs: string[] = []

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setupSource(): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-sync-cursors-'))
  tempDirs.push(dataDir)
  initDb(dataDir)
  const now = '2026-07-01T00:00:00.000Z'
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, track_id_snapshot, created_at, updated_at
    ) VALUES ('source-1', 123, '[1,2]', ?, ?)
  `).run(now, now)
}

describe('playlist source observation state', () => {
  it('advances observation and comparison cursors without claiming convergence', () => {
    setupSource()

    recordSourceObservation('source-1', {
      neteaseCursor: 'netease-playlist-v1:observed',
      plexFingerprint: 'plex-playlist-v1:before',
      observedAt: '2026-07-01T01:00:00.000Z',
    })
    recordSourceComparison('source-1', {
      neteaseCursor: 'netease-playlist-v1:observed',
      plexFingerprint: 'plex-playlist-v1:before',
      comparedAt: '2026-07-01T01:01:00.000Z',
    })

    expect(getSource('source-1')).toMatchObject({
      trackIdSnapshot: '[1,2]',
      lastObservedNeteaseCursor: 'netease-playlist-v1:observed',
      lastComparedNeteaseCursor: 'netease-playlist-v1:observed',
      lastObservedPlexFingerprint: 'plex-playlist-v1:before',
      lastAppliedPlexFingerprint: null,
      lastObservedAt: '2026-07-01T01:01:00.000Z',
      lastComparedAt: '2026-07-01T01:01:00.000Z',
    })
  })

  it('records a read-back Plex fingerprint as observed and application-owned atomically', () => {
    setupSource()

    recordAppliedPlexPlaylistFingerprint(
      'source-1',
      'plex-playlist-v1:after',
      '2026-07-01T02:00:00.000Z',
    )

    expect(getSource('source-1')).toMatchObject({
      lastObservedPlexFingerprint: 'plex-playlist-v1:after',
      lastAppliedPlexFingerprint: 'plex-playlist-v1:after',
      lastObservedAt: '2026-07-01T02:00:00.000Z',
    })
  })
})
