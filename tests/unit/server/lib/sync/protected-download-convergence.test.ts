import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { closeDb, getDb, initDb, writeConfigToDb } from '~~/server/lib/db'
import { startDownloadWorker, stopDownloadWorker } from '~~/server/lib/download/worker'
import { checkCookie, fetchAlbumSongs, fetchSongDetail, getSongUrl, type NeteaseSong } from '~~/server/lib/netease'
import { getSectionKey, getTracksByRatingKeys } from '~~/server/lib/plex-client'
import { createSource, getSource } from '~~/server/lib/playlist/store'
import { RunBuilder } from '~~/server/lib/run/builder'
import { saveSyncRun } from '~~/server/lib/run/store'
import { getSourceFailurePolicy } from '~~/server/lib/sync/failure-policy'
import { rebindSongIdentity } from '~~/server/lib/sync/identity-store'
import { getLocalMediaAsset } from '~~/server/lib/sync/local-media-store'
import { queueIdentityRealignment } from '~~/server/lib/sync/media-corrections'
import { scheduleSourceRecovery } from '~~/server/lib/sync/recovery'
import { executeSourceConvergence } from '~~/server/lib/sync/source-convergence'
import { addMissingDetailSongs } from '~~/server/lib/sync/source-preparation'
import { downloadSong } from '~~/server/lib/tag-writer'

vi.mock('~~/server/lib/netease', async (original) => ({
  ...await original<typeof import('~~/server/lib/netease')>(),
  checkCookie: vi.fn(),
  fetchAlbumDetail: vi.fn(),
  fetchAlbumSongs: vi.fn(),
  fetchSongDetail: vi.fn(),
  getSongUrl: vi.fn(),
}))
vi.mock('~~/server/lib/plex-client', async (original) => ({
  ...await original<typeof import('~~/server/lib/plex-client')>(),
  initPlexClient: vi.fn(),
  getSectionKey: vi.fn(),
  getTracksByRatingKeys: vi.fn(),
  findTracksByFilePath: vi.fn(async () => []),
  refreshLibrary: vi.fn(async () => { throw new Error('Unexpected Plex refresh') }),
}))
vi.mock('~~/server/lib/tag-writer', async (original) => ({
  ...await original<typeof import('~~/server/lib/tag-writer')>(),
  downloadSong: vi.fn(async () => { throw new Error('Unexpected audio write') }),
}))

const song: NeteaseSong = {
  id: 1001, name: 'Fixture Track', no: 1, dt: 180_000, disc: '1',
  artists: [{ name: 'Fixture Artist' }],
  album: { id: 2001, name: 'Fixture Album', picUrl: '', publishTime: 0 },
}
const flacFixture = 'tests/fixtures/silence.flac'
const mp3Fixture = 'tests/fixtures/silence.mp3'

describe('source convergence when a computed download path is occupied', () => {
  let dir: string
  let config: typeof DEFAULT_CONFIG
  let sourceId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'yunplex-protected-copy-'))
    initDb(dir)
    config = structuredClone(DEFAULT_CONFIG)
    Object.assign(config.sync, { enabled: true, skipPlexPlaylist: true })
    Object.assign(config.download, {
      dir: join(dir, 'music'), plexLibraryPathPrefix: '/fixture-library',
      downloadLyrics: false, embedCover: false, embedMetadata: false,
    })
    config.other.pathFormat = '{title}'
    mkdirSync(config.download.dir)
    writeConfigToDb(config)
    const source = await createSource(song.album.id, '', {
      type: 'album', name: song.album.name, coverUrl: '/fixture-cover.png', enabled: true,
    })
    sourceId = source.id
    vi.mocked(checkCookie).mockResolvedValue({ valid: true })
    vi.mocked(fetchAlbumSongs).mockResolvedValue([song])
    vi.mocked(fetchSongDetail).mockResolvedValue(song)
    vi.mocked(getSongUrl).mockResolvedValue({ url: 'https://example.invalid/audio.flac', type: 'flac' })
    vi.mocked(getSectionKey).mockResolvedValue('fixture-section')
    vi.mocked(getTracksByRatingKeys).mockResolvedValue(new Map())
    startDownloadWorker(() => config)
  })

  afterEach(async () => {
    await stopDownloadWorker()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
  })

  function file(ext: 'flac' | 'mp3') {
    return join(config.download.dir, `${song.name}.${ext}`)
  }

  async function sync(trigger: 'schedule' | 'user' = 'schedule') {
    const job = new RunBuilder(false)
    saveSyncRun(job.getRun())
    const result = await executeSourceConvergence({
      source: getSource(sourceId)!, config, options: { trigger }, job,
      signal: new AbortController().signal, readCurrentConfig: () => config,
      observer: { failure: vi.fn(), stage: vi.fn(), log: vi.fn() },
    })
    const run = job.finish(result.status, result.summary)
    saveSyncRun(run)
    return run
  }

  function fileTasks() {
    return getDb().prepare('SELECT id, status, error_code, retry_count FROM download_tasks WHERE song_id=?').all(song.id)
  }

  function failures() {
    return getDb().prepare('SELECT failure_kind, status, attempt_count FROM failure_records WHERE source_id=? AND song_id=?').all(sourceId, song.id)
  }

  function stageAudio(stagedFixture: string, occupyingFixture?: string) {
    const publish = vi.fn((from: string, to: string) => renameSync(from, to))
    vi.mocked(downloadSong).mockImplementationOnce(async (_url, _meta, _type, _dir, options, relativePath) => {
      const staged = join(dir, 'staged-audio')
      const target = join(config.download.dir, relativePath!)
      copyFileSync(stagedFixture, staged)
      if (occupyingFixture) copyFileSync(occupyingFixture, target)
      const result = {
        filePath: target,
        ops: { download: 'ok', lyric: 'skipped', tags: 'skipped', cover: 'skipped' } as const,
      }
      await options.commitFile!(result, () => publish(staged, target))
      return result
    })
    return publish
  }

  it('does not retry a persisted collision on the next sync and accepts an explicit media choice', async () => {
    copyFileSync(flacFixture, file('flac'))
    const original = readFileSync(file('flac'))

    const first = await sync()
    expect(first.songs).toMatchObject([{ status: 'awaiting_manual_match', error: { code: 'media_identity_conflict' } }])
    expect(first).toMatchObject({ failedSongs: 0, issueCounts: { manual: 1 } })
    const manualFailure = { failure_kind: 'media_identity_conflict', status: 'open', attempt_count: 1 }
    expect(failures()).toEqual([manualFailure])
    const tasks = fileTasks()
    expect(tasks).toMatchObject([{ status: 'failed', error_code: 'media_identity_conflict', retry_count: 0 }])
    expect(scheduleSourceRecovery(sourceId, config)).toBeNull()

    const second = await sync()
    expect(second.songs).toMatchObject([{ status: 'awaiting_manual_match', error: { code: 'media_identity_conflict' } }])
    expect(fileTasks()).toEqual(tasks)
    expect(failures()).toEqual([manualFailure])
    expect(scheduleSourceRecovery(sourceId, config)).toBeNull()
    expect(getSongUrl).toHaveBeenCalledTimes(1)
    expect(downloadSong).not.toHaveBeenCalled()
    expect(readFileSync(file('flac'))).toEqual(original)

    const detailMissing = new RunBuilder(false)
    addMissingDetailSongs(detailMissing, sourceId, [song.id], getSourceFailurePolicy(sourceId), [song.id])
    expect(detailMissing.getRun().songs).toMatchObject([{ status: 'awaiting_manual_match', error: { code: 'media_identity_conflict' } }])

    const plexFilePath = `/fixture-library/${song.name}.flac`
    const track = {
      ratingKey: 'fixture-track', title: song.name, parentTitle: song.album.name,
      grandparentTitle: song.artists[0]!.name, Media: [{ Part: [{ file: plexFilePath }] }],
    }
    vi.mocked(getTracksByRatingKeys).mockResolvedValue(new Map([[track.ratingKey, track]]))
    const { binding } = rebindSongIdentity({
      sourceId, neteaseSongId: song.id, expectedBindingUpdatedAt: null,
      binding: {
        plexSectionKey: 'fixture-section', plexSectionRoot: '/fixture-library',
        plexFilePath, plexRatingKey: track.ratingKey, evidence: {},
      },
    })
    const realignment = queueIdentityRealignment(song.id, binding.updatedAt)
    expect(realignment.requestIds).toHaveLength(1)
    expect(failures()).toMatchObject([{ failure_kind: 'media_identity_conflict', status: 'resolved' }])
    const recovered = await sync('user')
    expect(recovered.songs).toMatchObject([{
      status: 'skipped_existing', metadata: { matchTrace: { decision: 'bound', ratingKey: track.ratingKey } },
    }])
    expect(recovered).toMatchObject({ failedSongs: 0, issueCounts: { manual: 0 } })
    expect(fileTasks()).toEqual(tasks)
    expect(downloadSong).not.toHaveBeenCalled()
    expect(readFileSync(file('flac'))).toEqual(original)
  })

  it('publishes a separate MP3 and registers its ownership when only the FLAC path is occupied', async () => {
    copyFileSync(flacFixture, file('flac'))
    vi.mocked(getSongUrl).mockResolvedValueOnce({ url: 'https://example.invalid/audio.mp3', type: 'mp3' })
    const publish = stageAudio(mp3Fixture)

    await sync()

    expect(publish).toHaveBeenCalledOnce()
    expect(readFileSync(file('flac'))).toEqual(readFileSync(flacFixture))
    expect(readFileSync(file('mp3'))).toEqual(readFileSync(mp3Fixture))
    expect(fileTasks()).toMatchObject([{ status: 'done', error_code: null }])
    expect(getLocalMediaAsset(song.id)).toMatchObject({ ownership: 'managed', filePath: file('mp3') })
  })

  it('preserves the file and leaves ownership unset when the target appears just before publish', async () => {
    const publish = stageAudio(flacFixture, mp3Fixture)

    const run = await sync()

    expect(run.songs).toMatchObject([{ status: 'awaiting_manual_match', error: { code: 'media_identity_conflict' } }])
    expect(publish).not.toHaveBeenCalled()
    expect(readFileSync(file('flac'))).toEqual(readFileSync(mp3Fixture))
    expect(getLocalMediaAsset(song.id)).toBeNull()
    expect(fileTasks()).toMatchObject([{ status: 'failed', error_code: 'media_identity_conflict' }])
  })

  it('still schedules recovery for a persisted transient network failure', async () => {
    vi.mocked(getSongUrl).mockRejectedValueOnce(new Error('网易云请求超时'))

    const run = await sync()

    expect(run.songs).toMatchObject([{ error: { code: 'netease_unavailable' } }])
    expect(failures()).toEqual([{ failure_kind: 'netease_unavailable', status: 'open', attempt_count: 1 }])
    const id = scheduleSourceRecovery(sourceId, config)
    expect(id).toBeTruthy()
    const request = getDb().prepare('SELECT status, available_at, follow_up_of FROM source_sync_queue WHERE id=?')
      .get(id) as { status: string; available_at: string; follow_up_of: string }
    expect(request).toMatchObject({ status: 'pending', follow_up_of: expect.stringMatching(/^recovery:/) })
    expect(Date.parse(request.available_at)).toBeGreaterThan(Date.now())
  })
})
