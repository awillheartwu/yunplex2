import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb, readConfigFromDb } from '~~/server/lib/db'
import { createManualDownloadRun, getRun, syncManualDownloadRun } from '~~/server/lib/run/store'
import { submitFileTasks } from '~~/server/lib/download/file-task-command'
import { createDownloadWorker } from '~~/server/lib/download/worker'
import { getDownloadTask, listPendingDownloadTaskIds } from '~~/server/lib/download/queue'
import { setSyncService } from '~~/server/lib/sync/instance'
import { getSyncService } from '~~/server/lib/sync/service'
import { persistSourceRequest } from '~~/server/lib/sync/request-store'
import { deleteSourceAndStopWork } from '~~/server/lib/playlist/delete-source'
import { applyPlaylistSourceBatchAction } from '~~/server/lib/playlist/batch-actions'
import { getSource } from '~~/server/lib/playlist/store'

let directory = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-delete-source-'))
  initDb(directory)
  const insert = getDb().prepare(`INSERT INTO playlist_sources (id,netease_playlist_id,name,created_at,updated_at)
    VALUES (?, ?, ?, '2026-10-20', '2026-10-20')`)
  insert.run('source-a', 1, 'A'); insert.run('source-b', 2, 'B')
  for (const id of ['a', 'b']) createManualDownloadRun({ id, total: 1, sourceLabel: id, sourceIds: [`source-${id}`] })
  setSyncService(getSyncService(readConfigFromDb))
})
afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }) })

const intent = (sourceId: string, jobId: string, songId: number) => ({
  sourceId, jobId, songId, songName: 'Song', artist: 'Artist', album: 'Album', idempotencyKey: `song:${songId}`,
})

describe('delete a source with accepted work', () => {
  it.each(['single', 'batch'])('%s deletion aborts its active file, prevents pending work, and retains task records', async mode => {
    const files = submitFileTasks([intent('source-a', 'a', 1), intent('source-a', 'a', 2)])
    let began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const signals: AbortSignal[] = []
    const worker = createDownloadWorker({ getConcurrency: () => 1, execute: async (_task, _progress, signal) => {
      signals.push(signal); began()
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    } })
    const draining = worker.wake()
    await started
    if (mode === 'batch') await applyPlaylistSourceBatchAction('delete', ['source-a'])
    else await deleteSourceAndStopWork('source-a')
    await draining
    expect(getSource('source-a')).toBeNull()
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
    expect(files.readResults()).toHaveLength(2)
    expect(listPendingDownloadTaskIds()).toEqual([])
    expect(syncManualDownloadRun('a')?.status).toBe('cancelled')
    await worker.stop()
  })

  it('preserves an in-flight shared task and the other source caller', async () => {
    const first = submitFileTasks([intent('source-a', 'a', 1)])
    const other = submitFileTasks([intent('source-b', 'b', 1)])
    expect(first.taskIds).toEqual(other.taskIds)
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
    await deleteSourceAndStopWork('source-a')
    expect(signal.aborted).toBe(false)
    finish()
    await draining
    expect(getDownloadTask(other.taskIds[0]!)?.status).toBe('done')
    expect(getSource('source-b')).not.toBeNull()
    expect(getRun('a')?.status).toBe('cancelled')
    expect(getRun('b')?.status).toBe('success')
    await worker.stop()
  })

  it('cancels only the deleted source within a pending batch', async () => {
    for (const id of ['a', 'b']) persistSourceRequest({ sourceId: `source-${id}`, kind: 'convergence', trigger: 'user', batchId: 'batch' })
    await deleteSourceAndStopWork('source-a')
    expect(getDb().prepare('SELECT source_id,status FROM source_sync_queue').all()).toEqual([{ source_id: 'source-b', status: 'pending' }])
  })

  it('does not cancel another source that is already running', async () => {
    const active = persistSourceRequest({ sourceId: 'source-b', kind: 'convergence', trigger: 'user' })
    getDb().prepare("UPDATE source_sync_queue SET status='running' WHERE id=?").run(active)
    const service = getSyncService(readConfigFromDb)
    setSyncService({ ...service, getCurrentRun: () => {
      const run = getRun('b')
      return run ? { ...run, type: 'sync' as const } : null
    }, cancelSync: () => { throw new Error('Other source must continue') } })
    await deleteSourceAndStopWork('source-a')
    expect(getDb().prepare('SELECT status,cancel_requested_at FROM source_sync_queue WHERE id=?').get(active))
      .toEqual({ status: 'running', cancel_requested_at: null })
  })

  it('also cancels a preview whose live run details are intentionally hidden', async () => {
    const request = persistSourceRequest({ sourceId: 'source-a', kind: 'convergence', trigger: 'user', mode: 'preview', runId: 'preview-run' })
    getDb().prepare("UPDATE source_sync_queue SET status='running' WHERE id=?").run(request)
    const service = getSyncService(readConfigFromDb)
    let cancelled = false
    setSyncService({ ...service, getState: () => ({ ...service.getState(), currentRunId: 'preview-run', isRunning: true, dryRun: true }),
      getCurrentRun: () => null, cancelSync: () => {
        cancelled = true
        getDb().prepare("UPDATE source_sync_queue SET status='cancelled' WHERE id=?").run(request)
        return true
      } })
    await deleteSourceAndStopWork('source-a')
    expect(cancelled).toBe(true)
  })
})
