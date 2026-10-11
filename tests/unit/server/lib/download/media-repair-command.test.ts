import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createRepairRun, getRun, syncRepairRun } from '~~/server/lib/run/store'
import { getLocalMediaAsset } from '~~/server/lib/sync/local-media-store'
import { persistSourceRequest } from '~~/server/lib/sync/request-store'
import { readConfig } from '~~/server/lib/config/store'
import { enqueueTask } from '~~/server/lib/download/queue'
import { submitFileTasks } from '~~/server/lib/download/file-task-command'
import { startDownloadWorker, stopDownloadWorker } from '~~/server/lib/download/worker'

const mocks = vi.hoisted(() => ({
  fetchPlaylistSongs: vi.fn(),
  fetchAlbumSongs: vi.fn(),
  fetchSongDetail: vi.fn(),
  setArtistAliases: vi.fn(),
  findExistingLocalSongPath: vi.fn(),
  downloadSingleSong: vi.fn(),
  initPlexClient: vi.fn(),
  getSectionKey: vi.fn(),
  refreshLibrary: vi.fn(),
  setRepairRunning: vi.fn(),
  syncService: {
    getState: vi.fn(),
  },
}))

vi.mock('~~/server/lib/netease', () => ({
  fetchPlaylistSongs: mocks.fetchPlaylistSongs,
  fetchAlbumSongs: mocks.fetchAlbumSongs,
  fetchSongDetail: mocks.fetchSongDetail,
  setArtistAliases: mocks.setArtistAliases,
}))
vi.mock('~~/server/lib/sync/local-file-discovery', () => ({
  findExistingLocalSongPath: mocks.findExistingLocalSongPath,
}))
vi.mock('~~/server/lib/download/single-song', () => ({
  downloadSingleSong: mocks.downloadSingleSong,
}))
vi.mock('~~/server/lib/plex-client', () => ({
  initPlexClient: mocks.initPlexClient,
  getSectionKey: mocks.getSectionKey,
  refreshLibrary: mocks.refreshLibrary,
}))
vi.mock('~~/server/lib/sync/instance', () => ({
  getSyncServiceInstance: () => mocks.syncService,
  setRepairRunning: mocks.setRepairRunning,
}))

let directory = ''
let audioPath = ''

beforeEach(() => {
  vi.resetAllMocks()
  mocks.syncService.getState.mockReturnValue({ isRunning: false })
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-media-repair-'))
  audioPath = join(directory, 'song.flac')
  writeFileSync(audioPath, 'audio')
  initDb(directory)
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, type, created_at, updated_at
    ) VALUES ('source-one', 1001, '来源一', 'playlist', ?, ?)
  `).run(now, now)

  mocks.fetchPlaylistSongs.mockResolvedValue({
    songs: [{ id: 101, name: 'Song' }],
  })
  mocks.fetchSongDetail.mockResolvedValue({
    id: 101,
    name: 'Song',
    no: 1,
    dt: 180_000,
    disc: '1',
    artists: [{ name: 'Artist' }],
    album: { id: 9, name: 'Album', publishTime: 0, picUrl: '' },
  })
  mocks.findExistingLocalSongPath.mockReturnValue(audioPath)
  mocks.downloadSingleSong.mockResolvedValue({
    filePath: audioPath,
    fileType: 'flac',
    ops: { download: 'skipped', lyric: 'ok', tags: 'ok', cover: 'skipped' },
    audioOperation: 'reused',
  })
  mocks.getSectionKey.mockResolvedValue('12')
  startDownloadWorker(() => readConfig())
})

afterEach(async () => {
  const { waitForMediaRepairCommands } = await import('~~/server/lib/download/media-repair-command')
  await waitForMediaRepairCommands()
  await stopDownloadWorker()
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

describe('Media Repair Command', () => {
  it.each([
    { status: 'pending', kind: 'analysis' },
    { status: 'pending', kind: 'convergence' },
    { status: 'running', kind: 'analysis' },
    { status: 'running', kind: 'convergence' },
  ] as const)('rejects a $status $kind source request before fetching repair songs', async ({ status, kind }) => {
    const requestId = persistSourceRequest({
      sourceId: 'source-one',
      kind,
      trigger: 'user',
    })
    if (status === 'running') {
      getDb().prepare(`UPDATE source_sync_queue SET status = 'running' WHERE id = ?`).run(requestId)
    }
    const { startMediaRepairCommand } = await import('~~/server/lib/download/media-repair-command')

    await expect(startMediaRepairCommand('source-one')).rejects.toThrow('已有来源请求在队列中，请等待完成')
    expect(mocks.fetchPlaylistSongs).not.toHaveBeenCalled()
    expect(mocks.fetchAlbumSongs).not.toHaveBeenCalled()
  })

  it('rejects when Source Convergence is already running', async () => {
    mocks.syncService.getState.mockReturnValue({ isRunning: true })
    const { startMediaRepairCommand } = await import('~~/server/lib/download/media-repair-command')

    await expect(startMediaRepairCommand('source-one')).rejects.toThrow('已有同步任务在运行中，请等待完成')
    expect(mocks.fetchPlaylistSongs).not.toHaveBeenCalled()
  })

  it('persists the operation and target path before processing it', async () => {
    const {
      startMediaRepairCommand,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')

    const result = await startMediaRepairCommand('source-one')
    await waitForMediaRepairCommands()

    expect(result).toMatchObject({
      sourceId: 'source-one',
      totalSongs: 1,
      queuedSongs: 1,
      skippedSongs: 0,
    })
    expect(getDb().prepare(`
      SELECT operation, target_path, execution_intent_json, status, run_id
      FROM download_tasks
    `).get()).toEqual({
      operation: 'repair_existing',
      target_path: audioPath,
      execution_intent_json: JSON.stringify({
        downloadMode: 'missing',
        target: { kind: 'existing', path: audioPath },
        downloadLyrics: true,
        embedMetadata: true,
        embedCover: false,
      }),
      status: 'done',
      run_id: result.jobId,
    })
    expect(getRun(result.jobId)).toMatchObject({
      type: 'repair',
      status: 'success',
      totalSongs: 1,
      successSongs: 1,
      failedSongs: 0,
    })
    expect(getLocalMediaAsset(101)).toMatchObject({
      provenance: 'manual',
      ownership: 'external',
    })
    expect(mocks.downloadSingleSong).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        downloadMode: 'missing',
        target: { kind: 'existing', path: audioPath },
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(mocks.refreshLibrary).toHaveBeenCalledWith('12')
  })

  it('keeps the Run running during Plex refresh and resumes that post-processing after interruption', async () => {
    let markRefreshStarted!: () => void
    let releaseRefresh!: () => void
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve })
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
    mocks.refreshLibrary.mockImplementation(async () => {
      markRefreshStarted()
      await refreshGate
    })
    const {
      startMediaRepairCommand,
      stopMediaRepairCommands,
      resumePendingMediaRepairCommands,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')

    const result = await startMediaRepairCommand('source-one')
    await refreshStarted
    expect(getRun(result.jobId)).toMatchObject({ status: 'running', finishedAt: null, successSongs: 1 })

    const stopped = stopMediaRepairCommands()
    releaseRefresh()
    await stopped
    expect(getRun(result.jobId)).toMatchObject({ status: 'running', finishedAt: null, successSongs: 1 })

    mocks.refreshLibrary.mockResolvedValue(undefined)
    expect(resumePendingMediaRepairCommands()).toBe(true)
    await waitForMediaRepairCommands()
    expect(getRun(result.jobId)).toMatchObject({ status: 'success', successSongs: 1 })
    expect(mocks.refreshLibrary).toHaveBeenCalledTimes(2)
  })

  it('finishes cleanly when no existing media can be repaired', async () => {
    mocks.findExistingLocalSongPath.mockReturnValue(undefined)
    const {
      startMediaRepairCommand,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')

    const result = await startMediaRepairCommand('source-one')
    await waitForMediaRepairCommands()

    expect(result).toMatchObject({ queuedSongs: 0, skippedSongs: 1 })
    expect(getRun(result.jobId)).toMatchObject({
      status: 'success',
      skippedSongs: 1,
    })
    expect(mocks.downloadSingleSong).not.toHaveBeenCalled()
  })

  it('resumes terminal downloads to finish repair projection and Plex refresh after restart', async () => {
    const now = new Date().toISOString()
    createRepairRun({
      id: 'repair-resume',
      total: 1,
      skipped: 0,
      sourceId: 'source-one',
      sourceLabel: '来源一',
    })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, operation, target_path, created_at, updated_at
      ) VALUES (
        'repair-completed-task', 'source-one', 101, 'Song', 'Artist', 'Album', 'done', 100,
        'repair-resume', 'repair-resume', 'repair_existing', ?, ?, ?
      )
    `).run(audioPath, now, now)
    const {
      resumePendingMediaRepairCommands,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')

    expect(resumePendingMediaRepairCommands()).toBe(true)
    await waitForMediaRepairCommands()

    expect(getRun('repair-resume')).toMatchObject({ status: 'success', successSongs: 1 })
    expect(mocks.refreshLibrary).toHaveBeenCalledWith('12')
  })

  it('resumes its own repair run even when a source request is pending', async () => {
    const now = new Date().toISOString()
    createRepairRun({
      id: 'repair-resume-with-source-request',
      total: 1,
      skipped: 0,
      sourceId: 'source-one',
      sourceLabel: '来源一',
    })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, operation, target_path, created_at, updated_at
      ) VALUES (
        'repair-resume-with-request-task', 'source-one', 101, 'Song', 'Artist', 'Album', 'done', 100,
        'repair-resume-with-source-request', 'repair-resume-with-source-request', 'repair_existing', ?, ?, ?
      )
    `).run(audioPath, now, now)
    persistSourceRequest({
      sourceId: 'source-one',
      kind: 'analysis',
      trigger: 'user',
    })
    const {
      resumePendingMediaRepairCommands,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')

    expect(resumePendingMediaRepairCommands()).toBe(true)
    await waitForMediaRepairCommands()

    expect(getRun('repair-resume-with-source-request')).toMatchObject({
      status: 'success',
      successSongs: 1,
    })
  })

  it('resumes a reused repair task through its caller association after the owner finished', async () => {
    const now = new Date().toISOString()
    createRepairRun({ id: 'repair-shared-owner', total: 1, skipped: 0, sourceId: 'source-one', sourceLabel: '来源一' })
    const ownerHandle = submitFileTasks([{
      sourceId: 'source-one',
      songId: 101,
      songName: 'Song',
      artist: 'Artist',
      album: 'Album',
      jobId: 'repair-shared-owner',
      operation: 'repair_existing',
      targetPath: audioPath,
      idempotencyKey: 'repair-shared-association',
    }])
    createRepairRun({ id: 'repair-shared-caller', total: 1, skipped: 0, sourceId: 'source-one', sourceLabel: '来源一' })
    const callerHandle = submitFileTasks([{
      sourceId: 'source-one',
      songId: 101,
      songName: 'Song',
      artist: 'Artist',
      album: 'Album',
      jobId: 'repair-shared-caller',
      operation: 'repair_existing',
      targetPath: audioPath,
      idempotencyKey: 'repair-shared-association',
    }])
    expect(callerHandle.reusedTaskIds).toEqual(ownerHandle.taskIds)
    getDb().prepare(`
      UPDATE download_tasks
      SET status = 'done', progress = 100, updated_at = ?
      WHERE id = ?
    `).run(now, ownerHandle.taskIds[0])
    expect(syncRepairRun('repair-shared-owner')).toMatchObject({ status: 'success' })

    const {
      resumePendingMediaRepairCommands,
      waitForMediaRepairCommands,
    } = await import('~~/server/lib/download/media-repair-command')
    expect(resumePendingMediaRepairCommands()).toBe(true)
    await waitForMediaRepairCommands()

    expect(getRun('repair-shared-caller')).toMatchObject({ status: 'success', successSongs: 1 })
  })

  it('starts repair waiting on its task while an unrelated download remains active', async () => {
    await stopDownloadWorker()
    const config = readConfig()
    config.sync.downloadConcurrency = 1
    let releaseUnrelated!: () => void
    let markUnrelatedStarted!: () => void
    const unrelatedStarted = new Promise<void>(resolve => { markUnrelatedStarted = resolve })
    const unrelatedGate = new Promise<void>(resolve => { releaseUnrelated = resolve })
    const worker = startDownloadWorker(() => config, async task => {
      if (task.songId === 999) {
        markUnrelatedStarted()
        await unrelatedGate
      }
      return {
        filePath: task.songId === 999 ? '/tmp/unrelated.flac' : audioPath,
        fileType: 'flac',
        ops: { download: 'ok', tags: 'ok' },
        audioOperation: 'downloaded',
      }
    })
    enqueueTask({
      songId: 999,
      songName: 'Unrelated',
      artist: 'Artist',
      album: 'Album',
      idempotencyKey: 'unrelated-download',
    })
    void worker.wake()
    await unrelatedStarted

    const { startMediaRepairCommand, waitForMediaRepairCommands } = await import('~~/server/lib/download/media-repair-command')
    const result = await startMediaRepairCommand('source-one')

    expect(result).toMatchObject({ queuedSongs: 1 })
    expect(getDb().prepare(`
      SELECT status FROM download_tasks WHERE operation = 'repair_existing'
    `).get()).toEqual({ status: 'pending' })

    releaseUnrelated()
    await waitForMediaRepairCommands()

    expect(getRun(result.jobId)).toMatchObject({ status: 'success', successSongs: 1 })
    expect(mocks.refreshLibrary).toHaveBeenCalledWith('12')
  })
})
