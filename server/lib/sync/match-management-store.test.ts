import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import {
  appendSongIdentityEvent,
  listSongIdentityEvents,
  listPlaylistSourceTrackOccurrences,
  observePlaylistSourceTracks,
  queryMatchOverview,
  recordPlaylistAlignmentValidation,
} from './match-management-store'
import {
  BindingVersionConflictError,
  createMatchReview,
  decideMatchReview,
  getSongIdentityBinding,
  rebindSongIdentity,
  unbindSongIdentityWithMode,
  upsertVerifiedSongIdentityBinding,
} from './identity-store'
import { ensureMatchManagementSchema } from '../db/migrations'
import type { NeteaseSong } from '../netease'

const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-match-management-'))
  dirs.push(dir)
  initDb(dir)
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, netease_playlist_name, type, subscribed,
      enabled, cover_url, plex_playlist_name, plex_playlist_rating_key,
      track_count, sort_order, created_at, updated_at
    ) VALUES ('source-a', 1, '测试歌单', '测试歌单', 'playlist', 0, 1, '', '', '', 0, 0, ?, ?)
  `).run('2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z')
}

function song(id: number, name = `歌曲 ${id}`): NeteaseSong {
  return {
    id,
    name,
    no: id,
    dt: 180_000 + id,
    disc: '1',
    artists: [{ id: id * 10, name: `艺人 ${id}` }],
    album: {
      id: id * 100,
      name: `专辑 ${id}`,
      picUrl: `https://example.test/${id}.jpg`,
      publishTime: 0,
    },
  }
}

afterEach(() => {
  closeDb()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('playlist source track occurrences', () => {
  it('preserves duplicate song occurrences and distinguishes playlist removal from sync-limit exclusion', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      runId: 'run-1',
      managedSongs: [song(1), song(2), song(1)],
      managedSongIds: [1, 2, 1],
      allSongIds: [1, 2, 1, 3],
      observedAt: '2026-07-23T01:00:00.000Z',
    })

    expect(listPlaylistSourceTrackOccurrences('source-a')).toMatchObject([
      { neteaseSongId: 1, occurrence: 0, position: 0, membershipStatus: 'current' },
      { neteaseSongId: 2, occurrence: 0, position: 1, membershipStatus: 'current' },
      { neteaseSongId: 1, occurrence: 1, position: 2, membershipStatus: 'current' },
    ])

    observePlaylistSourceTracks({
      sourceId: 'source-a',
      runId: 'run-2',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1, 1, 3],
      observedAt: '2026-07-23T02:00:00.000Z',
    })

    const all = listPlaylistSourceTrackOccurrences('source-a', 'all')
    expect(all.find(item => item.neteaseSongId === 2)).toMatchObject({
      membershipStatus: 'removed',
      removalReason: 'netease_removed',
    })
    expect(all.find(item => item.neteaseSongId === 1 && item.occurrence === 1)).toMatchObject({
      membershipStatus: 'removed',
      removalReason: 'sync_limit_excluded',
    })
  })

  it('validates concrete Plex playlist occurrences and consumes duplicates exactly once', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1), song(1), song(2)],
      managedSongIds: [1, 1, 2],
      allSongIds: [1, 1, 2],
      observedAt: '2026-07-23T01:00:00.000Z',
    })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/artist/album/01.flac',
      plexRatingKey: '101',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 2,
      plexSectionKey: '1',
      plexFilePath: '/music/artist/album/02.flac',
      plexRatingKey: '102',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    expect(recordPlaylistAlignmentValidation({
      sourceId: 'source-a',
      playlistItems: [
        { ratingKey: '101', plexFilePaths: ['/music/artist/album/01.flac'] },
        { ratingKey: '102', plexFilePaths: ['/music/artist/album/02.flac'] },
      ],
      observedAt: '2026-07-23T02:00:00.000Z',
    })).toEqual({ aligned: 2, pending: 1, missing: 0 })
    expect(listPlaylistSourceTrackOccurrences('source-a').map(item => item.alignmentStatus))
      .toEqual(['aligned', 'pending', 'aligned'])

    expect(recordPlaylistAlignmentValidation({
      sourceId: 'source-a',
      playlistItems: [
        { ratingKey: '101', plexFilePaths: ['/music/artist/album/01.flac'] },
        { ratingKey: '101', plexFilePaths: ['/music/artist/album/01.flac'] },
        { ratingKey: '102', plexFilePaths: ['/music/artist/album/02.flac'] },
      ],
      observedAt: '2026-07-23T03:00:00.000Z',
    })).toEqual({ aligned: 3, pending: 0, missing: 0 })
    expect(listPlaylistSourceTrackOccurrences('source-a').map(item => item.alignmentStatus))
      .toEqual(['aligned', 'aligned', 'aligned'])
    expect(queryMatchOverview({ sourceId: 'source-a' }).items.map(item => item.state))
      .toEqual(['matched', 'matched', 'matched'])
    expect(getDb().prepare('SELECT requires_match_reconcile FROM playlist_sources WHERE id = ?').get('source-a'))
      .toEqual({ requires_match_reconcile: 0 })
  })
})

describe('immutable song identity events', () => {
  it('records automatic binding and manual rejection without rewriting earlier history', () => {
    setup()
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/artist/album/01.flac',
      plexRatingKey: '101',
      mbRecordingId: 'recording-1',
      bindingMethod: 'mb_recording',
      status: 'active',
      evidence: { sourceId: 'source-a', runId: 'run-1' },
    })
    const review = createMatchReview({
      neteaseSongId: 2,
      sourceId: 'source-a',
      runId: 'run-1',
      candidatePlexFilePath: '/music/other.flac',
      candidatePlexRatingKey: '202',
    })
    decideMatchReview(review.id, 'reject')

    const events = listSongIdentityEvents({})
    expect(events.map(event => event.eventType)).toEqual(['manual_reject', 'auto_bind'])
    expect(events[1]).toMatchObject({
      neteaseSongId: 1,
      actorType: 'system',
      sourceId: 'source-a',
      runId: 'run-1',
      nextBinding: { plexRatingKey: '101', bindingMethod: 'mb_recording' },
    })
    expect(events[0]).toMatchObject({
      neteaseSongId: 2,
      actorType: 'admin',
      reviewId: review.id,
    })

    appendSongIdentityEvent({
      neteaseSongId: 1,
      eventType: 'invalidate',
      actorType: 'system',
      previousBinding: events[1]!.nextBinding,
      nextBinding: null,
      evidence: { reason: 'file_missing' },
      createdAt: '2026-07-23T03:00:00.000Z',
    })
    expect(listSongIdentityEvents({ neteaseSongId: 1 })).toHaveLength(2)
  })

  it('uses optimistic binding versions and marks every referencing source pending alignment', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    const original = upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/old.flac',
      plexRatingKey: '10',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    const changed = rebindSongIdentity({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: original.updatedAt,
      binding: {
        plexSectionKey: '1',
        plexFilePath: '/music/new.flac',
        plexRatingKey: '11',
        mbRecordingId: null,
        evidence: {},
      },
    })
    expect(changed.affectedSources).toEqual([{ id: 'source-a', name: '测试歌单' }])
    expect(getSongIdentityBinding(1)?.plexRatingKey).toBe('11')
    expect(() => rebindSongIdentity({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: original.updatedAt,
      binding: {
        plexSectionKey: '1',
        plexFilePath: '/music/stale-choice.flac',
        plexRatingKey: '12',
        mbRecordingId: null,
        evidence: {},
      },
    })).toThrow(BindingVersionConflictError)
    expect(getSongIdentityBinding(1)?.plexRatingKey).toBe('11')
    expect(getDb().prepare('SELECT requires_match_reconcile FROM playlist_sources WHERE id = ?').get('source-a'))
      .toEqual({ requires_match_reconcile: 1 })
  })

  it('distinguishes reevaluation from excluding the current Plex file', () => {
    setup()
    const first = upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/current.flac',
      plexRatingKey: '10',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    unbindSongIdentityWithMode({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: first.updatedAt,
      mode: 'reevaluate',
    })
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM song_match_reviews WHERE status = 'rejected'").get())
      .toEqual({ count: 0 })

    const rebound = rebindSongIdentity({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: getSongIdentityBinding(1)!.updatedAt,
      binding: {
        plexSectionKey: '1',
        plexFilePath: '/music/current.flac',
        plexRatingKey: '10',
        mbRecordingId: null,
        evidence: {},
      },
    }).binding
    unbindSongIdentityWithMode({
      neteaseSongId: 1,
      expectedBindingUpdatedAt: rebound.updatedAt,
      mode: 'exclude_current',
    })
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM song_match_reviews WHERE status = 'rejected'").get())
      .toEqual({ count: 1 })
    expect(listSongIdentityEvents({ neteaseSongId: 1 }).map(event => event.eventType))
      .toContain('manual_exclude')
  })
})

describe('match-management migration and overview', () => {
  it('exposes managed media ownership in the playlist overview', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    getDb().prepare(`
      INSERT INTO local_media_assets (
        netease_song_id, file_path, provenance, ownership, status,
        evidence_json, created_at, updated_at
      ) VALUES (1, '/local/music/one.flac', 'download_task', 'managed', 'active',
        '{"audioOperation":"downloaded"}', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z')
    `).run()

    expect(queryMatchOverview({ sourceId: 'source-a' }).items[0]).toMatchObject({
      localMedia: {
        filePath: '/local/music/one.flac',
        ownership: 'managed',
        provenance: 'download_task',
        status: 'active',
        evidence: { audioOperation: 'downloaded' },
      },
    })
  })

  it('distinguishes an unverified historical occurrence from a required alignment change', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/artist/album/01.flac',
      plexRatingKey: '101',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    getDb().prepare(`
      UPDATE playlist_source_track_occurrences
      SET alignment_status = 'unknown'
      WHERE source_id = 'source-a'
    `).run()

    expect(queryMatchOverview({ sourceId: 'source-a' }).items[0]?.state)
      .toBe('historical_unverified')
  })

  it('uses locally persisted review evidence when a migrated target snapshot lacks metadata', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    getDb().prepare(`
      UPDATE playlist_source_track_occurrences
      SET title = '', artists_json = '[]', album_name = '', metadata_complete = 0
      WHERE source_id = 'source-a' AND netease_song_id = 1
    `).run()
    createMatchReview({
      neteaseSongId: 1,
      sourceId: 'source-a',
      candidatePlexRatingKey: '101',
      candidatePlexFilePath: '/music/candidate.flac',
      evidence: {
        desired: {
          title: '审核证据标题',
          artists: ['审核艺人'],
          album: '审核专辑',
        },
      },
    })

    expect(queryMatchOverview({ sourceId: 'source-a' }).items[0]?.target).toEqual({
      neteaseSongId: 1,
      title: '审核证据标题',
      artists: ['审核艺人'],
      albumName: '审核专辑',
      coverUrl: 'https://example.test/1.jpg',
      metadataSource: 'review_evidence',
    })
  })

  it('shows available target labels even when non-display metadata is historically incomplete', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    getDb().prepare(`
      UPDATE playlist_source_track_occurrences
      SET metadata_complete = 0, duration_ms = NULL
      WHERE source_id = 'source-a' AND netease_song_id = 1
    `).run()

    expect(queryMatchOverview({ sourceId: 'source-a' }).items[0]?.target).toMatchObject({
      title: '歌曲 1',
      artists: ['艺人 1'],
      albumName: '专辑 1',
      metadataSource: 'occurrence',
    })
  })

  it('backfills old track snapshots locally and remains idempotent at an advanced user_version', () => {
    setup()
    getDb().prepare(`
      UPDATE playlist_sources
      SET track_id_snapshot = ?, last_job_id = NULL
      WHERE id = 'source-a'
    `).run(JSON.stringify([1, 2, 1]))
    getDb().pragma('user_version = 999')

    ensureMatchManagementSchema(getDb())
    ensureMatchManagementSchema(getDb())
    expect(listPlaylistSourceTrackOccurrences('source-a').map(item => [item.neteaseSongId, item.occurrence]))
      .toEqual([[1, 0], [2, 0], [1, 1]])
  })

  it('keeps global bindings after deleting a source and exposes them as orphaned', () => {
    setup()
    observePlaylistSourceTracks({
      sourceId: 'source-a',
      managedSongs: [song(1)],
      managedSongIds: [1],
      allSongIds: [1],
    })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '1',
      plexFilePath: '/music/one.flac',
      plexRatingKey: '10',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    getDb().prepare('DELETE FROM playlist_sources WHERE id = ?').run('source-a')

    expect(getSongIdentityBinding(1)).not.toBeNull()
    expect(queryMatchOverview({ sourceId: 'orphaned' }).items).toHaveLength(1)
    expect(listSongIdentityEvents({ neteaseSongId: 1 }).length).toBeGreaterThan(0)
  })
})
