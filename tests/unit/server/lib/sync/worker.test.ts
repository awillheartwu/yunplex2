import { persistSourceRequest } from '~~/server/lib/sync/request-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppConfig } from '~~/server/lib/config/types'
import { cloneConfig } from '~~/server/lib/config/validation'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { startWorker, stopWorker } from '~~/server/lib/sync/worker'
import { enqueueManualSourceSync } from '~~/server/lib/sync/source-schedule-store'
import { ensurePendingInitialization, setInitializationStatus } from '~~/server/lib/source-initialization/store'
import { saveRun } from '~~/server/lib/run/store'

let directory = ''

function makeConfig(enabled = false): AppConfig {
  const config = cloneConfig(DEFAULT_CONFIG)
  config.sync.enabled = enabled
  config.sync.intervalMinutes = 30
  config.sync.initializeMediaOnFirstSync = false
  return config
}

function insertSource(id: string, order: number) {
  const now = new Date('2026-08-28T00:00:00.000Z').toISOString()
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name,
      sort_order, next_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(id, order + 1, id, id, order, now, now, now)
}

function makeService(runSyncForSource = vi.fn(async (_sourceId: string, _options?: { mode?: 'normal'; trigger?: 'schedule' }) => ({
  isRunning: false,
  lastSyncResult: 'success',
  failures: [],
}))) {
  return {
    getState: vi.fn(() => ({ isRunning: false })),
    prepareSyncForSource: vi.fn((sourceId: string, options?: { mode?: 'normal'; trigger?: 'schedule' }) => ({
      runId: `run-${sourceId}`,
      run: () => runSyncForSource(sourceId, options),
    })),
    cancelSync: vi.fn(() => false),
  }
}

function saveTestRun(id: string, type: 'source_initialization' | 'sync', status: 'awaiting_action' | 'running') {
  saveRun({
    id,
    type,
    trigger: 'user',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status,
    durationMs: 0,
    summary: id,
    source: 'source-1',
    sourceIds: ['source-1'],
    target: 'Plex',
    totalSongs: 0,
    successSongs: 0,
    failedSongs: 0,
    skippedSongs: 0,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    steps: [],
    songs: [],
    config: {},
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-worker-'))
  initDb(directory)
})

afterEach(async () => {
  await stopWorker()
  closeDb()
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('source scheduler worker', () => {
  it('consumes an explicit manual request while automatic scheduling is disabled', async () => {
    const config = makeConfig(false)
    insertSource('source-1', 0)
    enqueueManualSourceSync('source-1')
    const service = makeService()
    const worker = startWorker(() => config, service as never, directory)

    await worker.runOnce()

    expect(service.prepareSyncForSource).toHaveBeenCalledWith('source-1', {
      mode: 'normal',
      trigger: 'user',
    })
  })

  it('cancels a queued request without Source Convergence while initialization awaits review', async () => {
    const config = makeConfig(false)
    config.sync.initializeMediaOnFirstSync = true
    insertSource('source-1', 0)
    const initialization = ensurePendingInitialization('source-1', 'user')
    setInitializationStatus(initialization.id, 'awaiting_review', { runId: 'initialization-run' })
    enqueueManualSourceSync('source-1')
    const service = makeService()
    const worker = startWorker(() => config, service as never, directory)

    await worker.runOnce()

    expect(service.prepareSyncForSource).not.toHaveBeenCalled()
    expect(worker.getStatus().queueDepth).toBe(0)
    expect(getDb().prepare('SELECT status, run_id FROM source_sync_queue').get())
      .toEqual({ status: 'cancelled', run_id: null })
  })

  it('links an enabled source initialization to its first follow-up convergence run', async () => {
    const config = makeConfig(false)
    config.sync.initializeMediaOnFirstSync = true
    insertSource('source-1', 0)
    saveTestRun('initialization-run', 'source_initialization', 'awaiting_action')
    saveTestRun('follow-up-run', 'sync', 'running')
    const initialization = ensurePendingInitialization('source-1', 'user')
    setInitializationStatus(initialization.id, 'completed', { runId: 'initialization-run' })
    persistSourceRequest({ sourceId: 'source-1', kind: 'convergence', trigger: 'user', followUpOf: initialization.id })
    const service = makeService()
    service.prepareSyncForSource.mockReturnValue({
      runId: 'follow-up-run',
      run: async () => ({ isRunning: false, lastSyncResult: 'success', failures: [] }),
    } as never)
    const worker = startWorker(() => config, service as never, directory)

    await worker.runOnce()

    expect(getDb().prepare('SELECT follow_up_run_id FROM source_initializations WHERE id = ?').get(initialization.id))
      .toEqual({ follow_up_run_id: 'follow-up-run' })
    expect(getDb().prepare('SELECT run_id, related_run_id, relation FROM task_run_links ORDER BY run_id').all()).toEqual([
      { run_id: 'follow-up-run', related_run_id: 'initialization-run', relation: 'follow_up_of' },
      { run_id: 'initialization-run', related_run_id: 'follow-up-run', relation: 'initialization_follow_up' },
    ])
  })

  it('reuses the process worker when the daemon plugin initializes twice', () => {
    const config = makeConfig(false)
    const first = startWorker(() => config, makeService() as never, directory)
    const second = startWorker(() => config, makeService() as never, directory)

    expect(second).toBe(first)
  })

  it('stops polling and clears pending requests when disabled', () => {
    let config = makeConfig(true)
    insertSource('source-1', 0)
    const service = makeService()
    const worker = startWorker(() => config, service as never, directory)
    expect(worker.isScheduled()).toBe(true)

    config = makeConfig(false)
    worker.update()

    expect(worker.isScheduled()).toBe(false)
    expect(worker.getStatus().queueDepth).toBe(0)
  })

  it('consumes due sources when enabled', async () => {
    let config = makeConfig(false)
    insertSource('source-1', 0)
    const service = makeService()
    const worker = startWorker(() => config, service as never, directory)

    config = makeConfig(true)
    await worker.runOnce()

    expect(service.prepareSyncForSource).toHaveBeenCalledWith('source-1', {
      mode: 'normal',
      trigger: 'schedule',
    })
    expect(worker.getStatus().queueDepth).toBe(0)
  })

  it('runs multiple due sources serially through Source Convergence', async () => {
    const config = makeConfig(false)
    insertSource('source-1', 0)
    insertSource('source-2', 1)
    const calls: string[] = []
    let active = 0
    let maxActive = 0
    const run = vi.fn(async (sourceId: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      calls.push(sourceId)
      await Promise.resolve()
      active--
      return { isRunning: false, lastSyncResult: 'success', failures: [] }
    })
    const service = makeService(run)
    const worker = startWorker(() => config, service as never, directory)

    config.sync.enabled = true
    await worker.runOnce()

    expect(calls).toEqual(['source-1', 'source-2'])
    expect(maxActive).toBe(1)
    expect(worker.getStatus().runningCount).toBe(0)
  })

  it('queues due work but waits while the sync service is already busy', async () => {
    const config = makeConfig(false)
    insertSource('source-1', 0)
    const service = makeService()
    service.getState.mockReturnValue({ isRunning: true } as never)
    const worker = startWorker(() => config, service as never, directory)

    config.sync.enabled = true
    await worker.runOnce()

    expect(service.prepareSyncForSource).not.toHaveBeenCalled()
    expect(worker.getStatus().queueDepth).toBe(1)
  })

  it('queues due work but does not start Source Convergence during media repair', async () => {
    const config = makeConfig(false)
    insertSource('source-1', 0)
    const service = makeService()
    const worker = startWorker(() => config, service as never, directory, () => false)

    config.sync.enabled = true
    await worker.runOnce()

    expect(service.prepareSyncForSource).not.toHaveBeenCalled()
    expect(worker.getStatus().queueDepth).toBe(1)
  })
})
