import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../config/defaults'
import { resolveSingleSongConfig } from './options'

const enqueueTask = vi.fn()
const requestDownloadProcessing = vi.fn(async () => undefined)
const createManualDownloadRun = vi.fn()
const fetchSongDetail = vi.fn()

vi.mock('./queue', () => ({
  buildDownloadTaskIdempotencyKey: vi.fn(input => JSON.stringify(input)),
  enqueueTask,
  getQueueStatus: vi.fn(() => ({ pending: 0, downloading: 0, tagging: 0, done: 1, failed: 0, total: 1 })),
}))
vi.mock('./worker', () => ({ requestDownloadProcessing }))
vi.mock('../db', () => ({ getDb: () => ({ transaction: (callback: () => unknown) => callback }) }))
vi.mock('../db/file-task-schema', () => ({
  createFileTaskSchema: vi.fn(),
  linkRunFileTask: vi.fn(),
}))
vi.mock('./single-song', () => ({ downloadSingleSong: vi.fn() }))
vi.mock('../netease', () => ({
  fetchPlaylistSongs: vi.fn(),
  fetchAlbumSongs: vi.fn(),
  fetchSongDetail,
  setArtistAliases: vi.fn(),
}))
vi.mock('../run/store', () => ({ createManualDownloadRun, syncManualDownloadRun: vi.fn() }))
vi.mock('../sync/events', () => ({ emitEvent: vi.fn() }))

describe('download batch source context', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fetchSongDetail.mockResolvedValue({
      id: 123,
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { id: 9, name: 'Album' },
    })
    enqueueTask.mockImplementation(input => ({
      id: 'task-one',
      sourceId: input.sourceId,
      songId: input.songId,
      songName: input.songName,
      artist: input.artist,
      album: input.album,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      jobId: input.jobId,
      createdAt: '',
      updatedAt: '',
    }))
  })

  it('persists source attribution through run and queue task', async () => {
    const { runDownloadBatch } = await import('./download-batch')
    const config = {
      ...resolveSingleSongConfig(DEFAULT_CONFIG, {
        target: { kind: 'computed' as const, requireManagedCopy: true },
      }),
      artistAliases: {},
      applyAliasToAlbum: false,
    }

    await runDownloadBatch({
      type: 'songs',
      songIds: [123],
      sourceContext: { id: 'source-one', name: '来源一 · 下载并托管' },
      config,
    })

    expect(createManualDownloadRun).toHaveBeenCalledWith(expect.objectContaining({
      sourceLabel: '来源一 · 下载并托管',
      sourceIds: ['source-one'],
      songs: [expect.objectContaining({ sourceId: 'source-one', neteaseSongId: 123 })],
    }))
    expect(enqueueTask).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'source-one',
      songId: 123,
      idempotencyKey: expect.stringContaining('managed_copy'),
      executionIntent: expect.objectContaining({
        downloadMode: 'full',
        target: { kind: 'computed', requireManagedCopy: true },
      }),
    }))
    expect(requestDownloadProcessing).toHaveBeenCalledOnce()
  })

  it('creates its own run and returns all reused tasks', async () => {
    enqueueTask.mockReturnValue({
      id: 'existing-task',
      sourceId: 'source-one',
      songId: 123,
      songName: 'Song',
      artist: 'Artist',
      album: 'Album',
      status: 'downloading',
      progress: 50,
      retryCount: 0,
      jobId: 'existing-run',
      createdAt: '',
      updatedAt: '',
    })
    const { runDownloadBatch } = await import('./download-batch')
    const config = {
      ...resolveSingleSongConfig(DEFAULT_CONFIG, {
        target: { kind: 'computed' as const, requireManagedCopy: true },
      }),
      artistAliases: {},
      applyAliasToAlbum: false,
    }

    await expect(runDownloadBatch({
      type: 'songs',
      songIds: [123],
      sourceContext: { id: 'source-one', name: '来源一 · 下载并托管' },
      config,
    })).resolves.toMatchObject({
      total: 1,
      tasks: [{ taskId: 'existing-task', reused: true }],
      selectionFailures: [],
    })
    expect(createManualDownloadRun).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }))
    expect(requestDownloadProcessing).toHaveBeenCalledOnce()
  })
})
