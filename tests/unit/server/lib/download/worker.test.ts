import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { enqueueTask } from '~~/server/lib/download/queue'
import { createDownloadWorker } from '~~/server/lib/download/worker'

const tempDirs: string[] = []

function setupDb() {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-download-worker-'))
  tempDirs.push(directory)
  initDb(directory)
}

afterEach(() => {
  closeDb()
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('persistent download worker', () => {
  it('keeps concurrency global across repeated wakeups and drains tasks added while active', async () => {
    setupDb()
    for (let songId = 1; songId <= 4; songId++) {
      enqueueTask({ songId, songName: `Song ${songId}`, artist: '', album: '' })
    }

    let active = 0
    let maximumActive = 0
    const processed: number[] = []
    let releaseBothStarted!: () => void
    const bothStarted = new Promise<void>(resolve => { releaseBothStarted = resolve })
    let releaseFirstWave!: () => void
    const firstWave = new Promise<void>(resolve => { releaseFirstWave = resolve })
    const worker = createDownloadWorker({
      getConcurrency: () => 2,
      execute: async (task) => {
        active++
        maximumActive = Math.max(maximumActive, active)
        if (active === 2) releaseBothStarted()
        if (task.songId <= 2) await firstWave
        processed.push(task.songId)
        active--
        return {
          filePath: `/tmp/worker-${task.songId}.flac`,
          fileType: 'flac',
          ops: { download: 'ok', tags: 'ok' },
          audioOperation: 'downloaded',
        }
      },
    })

    const firstWake = worker.wake()
    const repeatedWake = worker.wake()
    await bothStarted
    enqueueTask({ songId: 5, songName: 'Song 5', artist: '', album: '' })
    worker.wake()
    releaseFirstWave()
    await Promise.all([firstWake, repeatedWake, worker.waitForIdle()])

    expect(maximumActive).toBe(2)
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(getDb().prepare("SELECT COUNT(*) count FROM download_tasks WHERE status='done'").get())
      .toEqual({ count: 5 })
    await worker.stop()
  })

  it('fills a free global slot with newly submitted work before an unrelated task completes', async () => {
    setupDb()
    enqueueTask({ songId: 20, songName: 'Slow download', artist: '', album: '' })
    let releaseSlow!: () => void
    const slow = new Promise<void>(resolve => { releaseSlow = resolve })
    const started: number[] = []
    const worker = createDownloadWorker({
      getConcurrency: () => 2,
      execute: async task => {
        started.push(task.songId)
        if (task.songId === 20) await slow
        return { filePath: `/tmp/worker-${task.songId}.flac`, fileType: 'flac' }
      },
    })
    try {
      void worker.wake()
      expect(started).toEqual([20])
      enqueueTask({ songId: 21, songName: 'Later repair', artist: '', album: '', operation: 'repair_existing' })
      void worker.wake()
      await expect.poll(() => started, { timeout: 200 }).toEqual([20, 21])
      expect(getDb().prepare('SELECT status FROM download_tasks WHERE song_id=20').get()).toEqual({ status: 'downloading' })
    } finally {
      releaseSlow()
      await worker.stop()
    }
  })

  it('stops claiming pending work and leaves it recoverable after active slots finish', async () => {
    setupDb()
    for (let songId = 10; songId <= 13; songId++) {
      enqueueTask({ songId, songName: `Song ${songId}`, artist: '', album: '' })
    }

    let active = 0
    let releaseActive!: () => void
    let notifyActive!: () => void
    const activeSlotsFilled = new Promise<void>(resolve => { notifyActive = resolve })
    const activeGate = new Promise<void>(resolve => { releaseActive = resolve })
    const processed: number[] = []
    const worker = createDownloadWorker({
      getConcurrency: () => 2,
      execute: async (task) => {
        active++
        if (active === 2) notifyActive()
        await activeGate
        processed.push(task.songId)
        active--
        return { filePath: `/tmp/worker-${task.songId}.flac`, fileType: 'flac' }
      },
    })

    void worker.wake()
    await activeSlotsFilled
    const stopped = worker.stop()
    releaseActive()
    await stopped

    const pending = getDb().prepare("SELECT song_id FROM download_tasks WHERE status='pending' ORDER BY song_id").all() as Array<{ song_id: number }>
    expect(processed).toHaveLength(2)
    expect(pending).toHaveLength(2)
    expect([...processed, ...pending.map(row => row.song_id)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13])
  })
})
