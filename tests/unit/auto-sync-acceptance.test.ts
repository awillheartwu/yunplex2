import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneConfig } from '../../server/lib/config/validation'
import { DEFAULT_CONFIG } from '../../server/lib/config/defaults'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import { getSource, updateSource } from '../../server/lib/playlist/store'
import { enqueueTask, processAll } from '../../server/lib/download/queue'
import { startWorker, stopWorker } from '../../server/lib/sync/worker'

let directory = ''

function insertSource(id: string, order: number, dueAt: string) {
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name,
      sort_order, next_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(id, 10_000 + order, id, id, order, dueAt, dueAt, dueAt)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-auto-sync-acceptance-'))
  initDb(directory)
})

afterEach(async () => {
  await stopWorker()
  vi.useRealTimers()
  closeDb()
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('automatic sync acceptance', () => {
  it('serially converges due sources, skips future work, and continues after one failure', async () => {
    const dueAt = '2026-08-28T00:00:00.000Z'
    const now = new Date('2026-08-28T00:05:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    insertSource('success-source', 0, dueAt)
    insertSource('failure-source', 1, dueAt)
    insertSource('later-source', 2, '2026-08-28T01:00:00.000Z')
    const config = cloneConfig(DEFAULT_CONFIG)
    config.sync.enabled = true
    config.sync.intervalMinutes = 30
    config.sync.initializeMediaOnFirstSync = false
    let active = 0
    let maxActive = 0
    const calls: string[] = []
    let runSequence = 0
    let convergenceBusy = true
    const service = {
      getState: vi.fn(() => ({ isRunning: convergenceBusy })),
      cancelSync: vi.fn(() => false),
      prepareSyncForSource: vi.fn((sourceId: string) => {
        const runId = `acceptance-run-${++runSequence}`
        return {
          runId,
          run: async () => {
            active++
            maxActive = Math.max(maxActive, active)
            calls.push(sourceId)
            await Promise.resolve()
            const result = sourceId === 'failure-source' ? 'failure' : 'success'
            updateSource(sourceId, {
              lastSyncedAt: now.toISOString(),
              lastJobId: runId,
              lastObservedNeteaseCursor: `netease:${sourceId}`,
              lastComparedNeteaseCursor: `netease:${sourceId}`,
              lastObservedPlexFingerprint: `plex:${sourceId}`,
              lastAppliedPlexFingerprint: `plex:${sourceId}`,
            })
            active--
            return {
              isRunning: false,
              lastSyncResult: result,
              failures: result === 'failure'
                ? [{ songName: sourceId, reason: 'controlled upstream failure', timestamp: now.toISOString() }]
                : [],
            }
          },
        }
      }),
    }
    const worker = startWorker(() => config, service as never, directory)
    await Promise.resolve()
    convergenceBusy = false

    await worker.runOnce()

    expect(calls).toEqual(['success-source', 'failure-source'])
    expect(maxActive).toBe(1)
    expect(getSource('later-source')?.lastJobId).toBeNull()
    expect(getSource('success-source')).toMatchObject({
      lastScheduleStatus: 'success',
      lastObservedNeteaseCursor: 'netease:success-source',
      lastAppliedPlexFingerprint: 'plex:success-source',
    })
    expect(getSource('failure-source')).toMatchObject({
      lastScheduleStatus: 'failed',
      lastScheduleError: 'controlled upstream failure',
    })
    expect(getDb().prepare(`
      SELECT status, COUNT(*) AS count FROM source_sync_queue GROUP BY status ORDER BY status
    `).all()).toEqual([
      { status: 'completed', count: 1 },
      { status: 'failed', count: 1 },
    ])
  })

  it('keeps download execution within the configured global concurrency', async () => {
    for (let index = 1; index <= 6; index++) {
      enqueueTask({
        songId: index,
        songName: `Song ${index}`,
        artist: 'Artist',
        album: 'Album',
        idempotencyKey: `acceptance-${index}`,
      })
    }
    let active = 0
    let maxActive = 0

    await processAll(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
      return { filePath: '/tmp/acceptance.flac', fileType: 'flac' }
    }, undefined, 2)

    expect(maxActive).toBe(2)
    expect((getDb().prepare(`
      SELECT COUNT(*) AS count FROM download_tasks WHERE status != 'done'
    `).get() as { count: number }).count).toBe(0)
  })
})
