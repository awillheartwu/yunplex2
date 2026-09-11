import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneConfig } from '../config/validation'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, getDb, initDb } from '../db'
import { getSource, updateSource } from '../playlist/store'
import {
  claimNextSourceRequest,
  enqueueManualSourceSync,
  finishSourceRequest,
  getSourceScheduleSnapshot,
  nextSourceDueAt,
  reconcileSourceSchedules,
  recoverInterruptedSourceRequests,
} from './source-schedule-store'

let directory = ''

function config(intervalMinutes = 30) {
  const value = cloneConfig(DEFAULT_CONFIG)
  value.sync.initializeMediaOnFirstSync = false
  value.sync.enabled = true
  value.sync.intervalMinutes = intervalMinutes
  return value
}

function insertSource(id: string, now: Date, options: { interval?: number | null; lastSyncedAt?: Date | null } = {}) {
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name,
      sync_interval_minutes, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(id.replace(/\D/g, '')) || 1,
    id,
    id,
    options.interval ?? null,
    options.lastSyncedAt?.toISOString() ?? null,
    now.toISOString(),
    now.toISOString(),
  )
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-source-schedule-'))
  initDb(directory)
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

describe('source schedule store', () => {
  it('keeps one manual request claimable when automatic scheduling is disabled', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    const first = enqueueManualSourceSync('source-1', now)
    expect(enqueueManualSourceSync('source-1', now)).toBe(first)
    const request = claimNextSourceRequest('worker', now)
    expect(request).toMatchObject({ id: first, sourceId: 'source-1', trigger: 'user' })
  })

  it('enqueues only sources whose independent interval is due', () => {
    const base = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', base, { interval: 1, lastSyncedAt: base })
    insertSource('source-2', base, { interval: 5, lastSyncedAt: base })
    const now = new Date(base.getTime() + 2 * 60_000)

    expect(reconcileSourceSchedules(config(), now)).toBe(1)
    expect(claimNextSourceRequest('worker', now)?.sourceId).toBe('source-1')
    expect(claimNextSourceRequest('worker', now)).toBeNull()
    expect(getSource('source-2')?.nextSyncAt).toBe('2026-08-28T00:05:00.000Z')
  })

  it('allows only one globally running request across competing consumers', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    insertSource('source-2', now)
    reconcileSourceSchedules(config(), now)

    expect(claimNextSourceRequest('worker-a', now)).not.toBeNull()
    expect(claimNextSourceRequest('worker-b', now)).toBeNull()
  })

  it('keeps one idempotent request for the same schedule window', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)

    expect(reconcileSourceSchedules(config(), now)).toBe(1)
    expect(reconcileSourceSchedules(config(), now)).toBe(0)
    expect(getSourceScheduleSnapshot().queueDepth).toBe(1)
  })

  it('cancels a pending request superseded by a newer manual sync', () => {
    const queuedAt = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', queuedAt)
    reconcileSourceSchedules(config(30), queuedAt)

    const manualSyncAt = new Date('2026-08-28T00:05:00.000Z')
    updateSource('source-1', { lastSyncedAt: manualSyncAt.toISOString() })
    reconcileSourceSchedules(config(30), manualSyncAt)

    expect(getSourceScheduleSnapshot().queueDepth).toBe(0)
    expect(getSource('source-1')?.nextSyncAt).toBe('2026-08-28T00:35:00.000Z')
    expect(getSource('source-1')?.lastScheduleStatus).toBe('idle')
    expect(getDb().prepare('SELECT status FROM source_sync_queue').get()).toEqual({ status: 'cancelled' })
  })

  it('recovers interrupted work after restart and makes it claimable again', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    reconcileSourceSchedules(config(), now)
    const first = claimNextSourceRequest('old-worker', now)
    expect(first).not.toBeNull()

    const restartedAt = new Date(now.getTime() + 1000)
    expect(recoverInterruptedSourceRequests(restartedAt)).toBe(1)
    expect(claimNextSourceRequest('new-worker', restartedAt)?.id).toBe(first?.id)
  })

  it('reclaims an expired lease created after the new worker startup check', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    reconcileSourceSchedules(config(), now)
    const stale = claimNextSourceRequest('old-worker', now, 1000)
    expect(stale).not.toBeNull()

    const afterExpiry = new Date(now.getTime() + 2000)
    reconcileSourceSchedules(config(), afterExpiry)

    const recovered = claimNextSourceRequest('new-worker', afterExpiry)
    expect(recovered?.id).toBe(stale?.id)
    expect(recovered?.attempts).toBe(2)
  })

  it('records failure without starving the next queued source', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now, { interval: 10 })
    insertSource('source-2', now, { interval: 10 })
    reconcileSourceSchedules(config(), now)

    const first = claimNextSourceRequest('worker', now)!
    finishSourceRequest(first, 'failure', config(), 'upstream failed', now)
    const second = claimNextSourceRequest('worker', now)

    expect(second).not.toBeNull()
    expect(second?.sourceId).not.toBe(first.sourceId)
    expect(getSource(first.sourceId)?.lastScheduleStatus).toBe('failed')
    expect(getSource(first.sourceId)?.nextSyncAt).toBe('2026-08-28T00:10:00.000Z')
  })

  it('honors failure retry time until a newer manual sync supersedes it', () => {
    const base = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', base, { interval: 10, lastSyncedAt: base })
    updateSource('source-1', {
      lastScheduleStatus: 'failed',
      lastScheduledAt: '2026-08-28T00:05:00.000Z',
      nextSyncAt: '2026-08-28T00:15:00.000Z',
    })
    const failed = getSource('source-1')!

    expect(nextSourceDueAt(failed, config(), base).toISOString()).toBe('2026-08-28T00:15:00.000Z')

    updateSource('source-1', { lastSyncedAt: '2026-08-28T00:06:00.000Z' })
    reconcileSourceSchedules(config(), new Date('2026-08-28T00:06:00.000Z'))
    const manuallySynced = getSource('source-1')!
    expect(nextSourceDueAt(manuallySynced, config(), base).toISOString()).toBe('2026-08-28T00:16:00.000Z')
    expect(manuallySynced.lastScheduleStatus).toBe('idle')
    expect(manuallySynced.lastScheduleError).toBeNull()
  })

  it('prunes finished requests with bounded retention', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    updateSource('source-1', { enabled: false })
    const insert = getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at,
        created_at, updated_at, finished_at
      ) VALUES (?, 'source-1', ?, ?, ?, ?, ?, ?)
    `)
    const oldCompleted = '2026-08-19T00:00:00.000Z'
    const oldFailed = '2026-07-20T00:00:00.000Z'
    const recent = '2026-08-27T00:00:00.000Z'
    insert.run('old-completed', oldCompleted, 'completed', oldCompleted, oldCompleted, oldCompleted, oldCompleted)
    insert.run('old-failed', oldFailed, 'failed', oldFailed, oldFailed, oldFailed, oldFailed)
    insert.run('recent-completed', recent, 'completed', recent, recent, recent, recent)

    reconcileSourceSchedules(config(), now)

    expect(getDb().prepare('SELECT id FROM source_sync_queue ORDER BY id').all())
      .toEqual([{ id: 'recent-completed' }])
  })

  it('cancels pending work when automatic sync is disabled', () => {
    const now = new Date('2026-08-28T00:00:00.000Z')
    insertSource('source-1', now)
    reconcileSourceSchedules(config(), now)
    const disabled = config()
    disabled.sync.enabled = false

    reconcileSourceSchedules(disabled, now)

    expect(getSourceScheduleSnapshot().queueDepth).toBe(0)
    expect(getSource('source-1')?.lastScheduleStatus).toBe('idle')
  })
})
