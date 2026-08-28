import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppConfig } from '../config/types'
import { cloneConfig } from '../config/validation'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, getDb, initDb } from '../db'
import { startWorker, stopWorker } from './worker'

let directory = ''

function makeConfig(enabled = false): AppConfig {
  const config = cloneConfig(DEFAULT_CONFIG)
  config.sync.enabled = enabled
  config.sync.intervalMinutes = 30
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

function makeService(runSyncForSource = vi.fn(async () => ({
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
})
