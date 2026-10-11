import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createManualDownloadRun, getRun, recoverInterruptedRuns } from '~~/server/lib/run/store'
import { enqueueTask, getDownloadTask, getQueueStatus, listPendingDownloadTaskIds, waitForDownloadTasks } from '~~/server/lib/download/queue'
import { createDownloadWorker, type DownloadWorker } from '~~/server/lib/download/worker'
import { submitFileTasks } from '~~/server/lib/download/file-task-command'
import { getDownloadQueueControl, pauseDownloadQueue, resumeDownloadQueue, setRunDownloadPaused } from '~~/server/lib/download/queue-control'
import { downloadFailurePolicy, MAX_AUTOMATIC_DOWNLOAD_RETRIES } from '~~/server/lib/download/retry-policy'

let directory = '', worker: DownloadWorker | null = null
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-download-resilience-'))
  initDb(directory)
})
afterEach(async () => {
  await worker?.stop()
  worker = null
  vi.useRealTimers()
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

const intent = (songId: number, jobId = 'batch') => ({ songId, songName: `Song ${songId}`, artist: '', album: '', jobId, idempotencyKey: `song-${songId}` })
function success(songId: number) {
  const filePath = join(directory, `${songId}.flac`)
  writeFileSync(filePath, 'fLaC')
  return { filePath, fileType: 'flac', ops: { download: 'ok', tags: 'ok' } }
}

describe('large persistent download batches', () => {
  it('drains 1500 shared tasks at global concurrency 3 with retryable and permanent failures', async () => {
    vi.useFakeTimers()
    createManualDownloadRun({ id: 'batch', total: 1500, sourceLabel: 'Large batch' })
    createManualDownloadRun({ id: 'second', total: 1500, sourceLabel: 'Shared batch' })
    const intents = Array.from({ length: 1500 }, (_, index) => intent(index + 1))
    const first = getDb().transaction(() => submitFileTasks(intents))()
    const shared = getDb().transaction(() => submitFileTasks(intents.map(value => ({ ...value, jobId: 'second' }))))()
    expect(shared.taskIds).toEqual(first.taskIds)
    let active = 0, maximumActive = 0
    const attempts = new Map<number, number>()
    worker = createDownloadWorker({ getConcurrency: () => 3, execute: async task => {
      const count = (attempts.get(task.songId) ?? 0) + 1
      attempts.set(task.songId, count)
      active++; maximumActive = Math.max(maximumActive, active)
      try {
        await Promise.resolve()
        if (task.songId === 1500) throw new Error('版权受限')
        if (task.songId % 50 === 0 && count === 1) throw Object.assign(new Error('network reset'), { code: 'ECONNRESET' })
        return success(task.songId)
      } finally { active-- }
    } })
    const draining = worker.wake()
    await vi.advanceTimersByTimeAsync(60_000)
    await draining
    expect(maximumActive).toBe(3)
    expect(getQueueStatus()).toMatchObject({ total: 1500, done: 1499, failed: 1, pending: 0 })
    expect(attempts.get(1500)).toBe(1)
    expect(attempts.get(50)).toBe(2)
    expect(getRun('batch')).toMatchObject({ status: 'partial', successSongs: 1499, failedSongs: 1 })
    expect(getRun('second')).toMatchObject({ status: 'partial', successSongs: 1499, failedSongs: 1 })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM failure_records WHERE song_id != 1500').get()).toEqual({ count: 0 })
  }, 20_000)

  it('exhausts a finite retry budget without multiplying failure history', async () => {
    vi.useFakeTimers()
    createManualDownloadRun({ id: 'batch', total: 1, sourceLabel: 'Failing batch' })
    const { taskIds } = submitFileTasks([intent(1)])
    let executions = 0
    worker = createDownloadWorker({ getConcurrency: () => 3, execute: async () => { executions++; throw new Error('network timeout') } })
    const draining = worker.wake()
    await vi.advanceTimersByTimeAsync(60_000)
    await draining
    expect(executions).toBe(1 + MAX_AUTOMATIC_DOWNLOAD_RETRIES)
    expect(getDownloadTask(taskIds[0]!)).toMatchObject({ status: 'failed', retryCount: 3, autoRetryCount: 3 })
    expect(getDb().prepare('SELECT occurrence_count AS count FROM failure_records').get()).toEqual({ count: 1 })
  })

  it('persists retry delay and resumes it after database reopen', async () => {
    vi.useFakeTimers()
    const task = enqueueTask(intent(1))
    worker = createDownloadWorker({ getConcurrency: () => 1, execute: async () => { throw new Error('network timeout') } })
    void worker.wake()
    await vi.advanceTimersByTimeAsync(1)
    const pending = getDownloadTask(task.id)!
    expect(pending).toMatchObject({ status: 'pending', autoRetryCount: 1 })
    expect(pending.nextAttemptAt).toBeTruthy()
    await worker.stop()
    closeDb(); initDb(directory); recoverInterruptedRuns()
    expect(getDownloadTask(task.id)?.nextAttemptAt).toBe(pending.nextAttemptAt)
    expect(listPendingDownloadTaskIds()).toEqual([])
    worker = createDownloadWorker({ getConcurrency: () => 1, execute: async value => success(value.songId) })
    const draining = worker.wake()
    await vi.advanceTimersByTimeAsync(10_000)
    await draining
    expect(getDownloadTask(task.id)).toMatchObject({ status: 'done', autoRetryCount: 1 })
  })

  it('shares a rate-limit cooldown and honors Retry-After', async () => {
    vi.useFakeTimers()
    const first = enqueueTask(intent(1)), second = enqueueTask(intent(2))
    const executed: number[] = []
    worker = createDownloadWorker({ getConcurrency: () => 1, execute: async task => {
      executed.push(task.songId)
      if (executed.length === 1) throw Object.assign(new Error('HTTP 429'), { httpStatus: 429, retryAfterMs: 45_000 })
      return success(task.songId)
    } })
    const draining = worker.wake()
    await vi.advanceTimersByTimeAsync(44_999)
    expect(executed).toEqual([1])
    await vi.advanceTimersByTimeAsync(100)
    await draining
    expect([getDownloadTask(first.id)?.status, getDownloadTask(second.id)?.status]).toEqual(['done', 'done'])
  })

  it('pauses on authentication or disk failure and preserves pending work for explicit resume', async () => {
    const first = enqueueTask(intent(1)), second = enqueueTask(intent(2))
    let fixed = false
    const execute = vi.fn(async task => {
      if (!fixed) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
      return success(task.songId)
    })
    worker = createDownloadWorker({ getConcurrency: () => 1, execute })
    await worker.wake()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getDownloadQueueControl()).toMatchObject({ paused: true, reason: 'filesystem' })
    expect(getDownloadTask(first.id)?.status).toBe('pending')
    expect(getDownloadTask(second.id)?.status).toBe('pending')
    fixed = true; resumeDownloadQueue()
    await worker.wake()
    expect(getQueueStatus()).toMatchObject({ done: 2, pending: 0, failed: 0 })
    expect(downloadFailurePolicy(Object.assign(new Error('网易云登录已失效'), { httpStatus: 401 }))).toMatchObject({ pauseReason: 'authentication' })
  })

  it('pauses one caller while continuing shared files for another caller', async () => {
    createManualDownloadRun({ id: 'batch', total: 2, sourceLabel: 'Paused caller' })
    createManualDownloadRun({ id: 'second', total: 1, sourceLabel: 'Active caller' })
    const first = submitFileTasks([intent(1), intent(2)])
    submitFileTasks([intent(1, 'second')])
    setRunDownloadPaused('batch', true)
    worker = createDownloadWorker({ getConcurrency: () => 1, execute: async task => success(task.songId) })
    await worker.wake()
    expect(first.readResults().map(task => task.status)).toEqual(['done', 'pending'])
    closeDb(); initDb(directory)
    expect(listPendingDownloadTaskIds()).toEqual([])
    setRunDownloadPaused('batch', false)
    await worker.wake()
    expect(first.readResults().map(task => task.status)).toEqual(['done', 'done'])
  })
})

describe('progress-based batch waiting', () => {
  it('continues beyond 30 minutes while persisted progress changes', async () => {
    vi.useFakeTimers()
    const task = enqueueTask(intent(1))
    const waiting = waitForDownloadTasks({ taskIds: [task.id], pollIntervalMs: 60_000 })
    for (let interval = 0; interval < 8; interval++) {
      getDb().prepare('UPDATE download_tasks SET progress=?,updated_at=? WHERE id=?').run(interval * 10, new Date().toISOString(), task.id)
      await vi.advanceTimersByTimeAsync(4 * 60_000)
    }
    getDb().prepare("UPDATE download_tasks SET status='done' WHERE id=?").run(task.id)
    await vi.advanceTimersByTimeAsync(60_000)
    await waiting
  })

  it('reports a stalled queue but waits through deliberate pause', async () => {
    vi.useFakeTimers()
    const task = enqueueTask(intent(1))
    const stalled = expect(waitForDownloadTasks({ taskIds: [task.id], inactivityTimeoutMs: 1000, pollIntervalMs: 250 })).rejects.toThrow('长时间无进展')
    await vi.advanceTimersByTimeAsync(1500); await stalled
    pauseDownloadQueue('manual', 'Paused')
    const waiting = waitForDownloadTasks({ taskIds: [task.id], inactivityTimeoutMs: 1000, pollIntervalMs: 250 })
    await vi.advanceTimersByTimeAsync(5000)
    getDb().prepare("UPDATE download_tasks SET status='done' WHERE id=?").run(task.id)
    await vi.advanceTimersByTimeAsync(250); await waiting
  })
})
