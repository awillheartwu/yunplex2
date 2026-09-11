import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, initDb } from '../db'
import { enqueueTask, getDownloadTask } from './queue'

const downloadSingleSong = vi.fn(async () => ({
  filePath: '/tmp/resumed.flac',
  fileType: 'flac',
  ops: { download: 'ok', tags: 'ok' },
  audioOperation: 'downloaded' as const,
}))

vi.mock('./single-song', () => ({ downloadSingleSong }))

const tempDirs: string[] = []

afterEach(async () => {
  const { stopDownloadWorker } = await import('./worker')
  await stopDownloadWorker()
  closeDb()
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('default download worker runtime', () => {
  it('rebuilds execution from the persisted non-sensitive task intent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'reyunplex-download-runtime-'))
    tempDirs.push(directory)
    initDb(directory)
    const task = enqueueTask({
      songId: 42,
      songName: 'Persisted',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      operation: 'managed_copy',
      executionIntent: {
        downloadMode: 'full',
        target: { kind: 'computed', requireManagedCopy: true },
        downloadLyrics: false,
        embedMetadata: true,
        embedCover: false,
      },
    })
    const { startDownloadWorker } = await import('./worker')
    const config = structuredClone(DEFAULT_CONFIG)
    config.netease.cookie = 'runtime-cookie'
    config.sync.downloadConcurrency = 1

    const worker = startDownloadWorker(() => config)
    await worker.wake()

    expect(downloadSingleSong).toHaveBeenCalledWith(42, expect.objectContaining({
      cookie: 'runtime-cookie',
      quality: 'lossless',
      downloadMode: 'full',
      target: { kind: 'computed', requireManagedCopy: true },
      downloadLyrics: false,
      embedMetadata: true,
      embedCover: false,
    }), expect.any(Function), expect.any(AbortSignal))
    expect(getDownloadTask(task.id)?.status).toBe('done')
  })

  it('starts by draining persisted pending tasks without an HTTP request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'reyunplex-download-runtime-'))
    tempDirs.push(directory)
    initDb(directory)
    const task = enqueueTask({ songId: 7, songName: 'Resume me', artist: '', album: '' })
    const { startDownloadWorker } = await import('./worker')
    const config = structuredClone(DEFAULT_CONFIG)

    const worker = startDownloadWorker(() => config)
    await worker.waitForIdle()

    expect(getDownloadTask(task.id)?.status).toBe('done')
  })
})
