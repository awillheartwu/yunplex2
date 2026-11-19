import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { linkRunFileTask } from '~~/server/lib/db/file-task-schema'
import { createManualDownloadRun } from '~~/server/lib/run/store'
import { enqueueTask, getDownloadTask, listPendingDownloadTaskIds } from '~~/server/lib/download/queue'
import { cancelRunDownloads } from '~~/server/lib/download/queue-control'
import { createDownloadWorker } from '~~/server/lib/download/worker'

let directory = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-cancel-download-'))
  initDb(directory)
  createManualDownloadRun({ id: 'cancelled-run', total: 2, sourceLabel: 'Cancelled' })
})
afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }) })

function task(songId: number) {
  const result = enqueueTask({ songId, songName: `Song ${songId}`, artist: 'Artist', album: 'Album', jobId: 'cancelled-run' })
  linkRunFileTask(getDb(), { runId: 'cancelled-run', taskId: result.id, sourceId: null })
  return result
}

describe('cancel a run and its file requests', () => {
  it('does not revive withdrawn files after their cancelled run history is removed', async () => {
    task(1)
    getDb().prepare("DELETE FROM task_runs WHERE id='cancelled-run'").run()
    expect(listPendingDownloadTaskIds()).toEqual([])
  })

  it('does not resume queued files belonging only to an already cancelled run', async () => {
    const pending = task(1)
    getDb().prepare("UPDATE task_runs SET status='cancelled' WHERE id='cancelled-run'").run()
    let started = 0
    const worker = createDownloadWorker({ getConcurrency: () => 1, execute: async () => {
      started++
      return { filePath: '/fixture/cancelled.flac', fileType: 'flac' }
    } })
    await worker.wake()
    expect(started).toBe(0)
    expect(getDownloadTask(pending.id)?.status).toBe('pending')
    await worker.stop()
  })

  it('aborts its active download, does not start pending files, and does not record a failure', async () => {
    const active = task(1), pending = task(2)
    let began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const signals: AbortSignal[] = []
    const worker = createDownloadWorker({
      getConcurrency: () => 1,
      execute: async (_task, _progress, signal) => {
        signals.push(signal)
        began()
        return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
      },
    })
    const draining = worker.wake()
    await started
    cancelRunDownloads('cancelled-run')
    await draining
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
    expect(getDownloadTask(active.id)).toMatchObject({ status: 'pending', retryCount: 0 })
    expect(getDownloadTask(pending.id)?.status).toBe('pending')
    expect(listPendingDownloadTaskIds()).toEqual([])
    expect(getDb().prepare('SELECT COUNT(*) count FROM failure_records').get()).toEqual({ count: 0 })
    // The withdrawn requests remain stopped when a consumer starts again.
    await worker.wake()
    expect(signals).toHaveLength(1)
    await worker.stop()
  })

  it('keeps a shared download running for another caller and stops the cancelled run remaining files', async () => {
    const shared = task(1)
    task(2)
    createManualDownloadRun({ id: 'other-run', total: 1, sourceLabel: 'Other' })
    linkRunFileTask(getDb(), { runId: 'other-run', taskId: shared.id, sourceId: null })
    let began!: () => void, finish!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const release = new Promise<void>(resolve => { finish = resolve })
    let signal!: AbortSignal
    const worker = createDownloadWorker({ getConcurrency: () => 1, execute: async (_task, _progress, current) => {
      signal = current; began(); await release
      return { filePath: '/fixture/shared.flac', fileType: 'flac' }
    } })
    const draining = worker.wake()
    await started
    cancelRunDownloads('cancelled-run')
    expect(signal.aborted).toBe(false)
    finish()
    await draining
    expect(getDownloadTask(shared.id)?.status).toBe('done')
    expect(listPendingDownloadTaskIds()).toEqual([])
    await worker.stop()
  })
})
