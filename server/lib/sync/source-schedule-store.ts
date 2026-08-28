import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import { getSource, listSources, updateSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'

export type SourceConvergenceRequestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SourceConvergenceRequest {
  id: string
  sourceId: string
  scheduleWindow: string
  attempts: number
  leaseOwner: string
}

export interface SourceScheduleSnapshot {
  queueDepth: number
  runningCount: number
  oldestQueuedAt: string | null
  nextSyncAt: string | null
  lastError: string | null
}

interface QueueRow {
  id: string
  source_id: string
  schedule_window: string
  attempts: number
}

const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const SOURCE_REQUEST_LEASE_MS = 90 * 1000

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function effectiveSourceIntervalMinutes(source: PlaylistSource, config: AppConfig): number {
  return Math.max(1, Math.min(1440, source.syncIntervalMinutes ?? (config.sync.intervalMinutes || 30)))
}

export function nextSourceDueAt(source: PlaylistSource, config: AppConfig, now: Date): Date {
  const intervalMs = effectiveSourceIntervalMinutes(source, config) * 60 * 1000
  const lastSynced = validDate(source.lastSyncedAt)
  const persisted = validDate(source.nextSyncAt)
  const lastScheduled = validDate(source.lastScheduledAt)
  const failedAfterLastSync = source.lastScheduleStatus === 'failed'
    && (!lastSynced || !lastScheduled || lastScheduled.getTime() >= lastSynced.getTime())
  if (failedAfterLastSync && persisted) return persisted
  if (lastSynced) return new Date(lastSynced.getTime() + intervalMs)
  return persisted ?? now
}

function pruneFinishedRequests(now: Date): void {
  const db = getDb()
  db.prepare(`
    DELETE FROM source_sync_queue
    WHERE status IN ('completed','cancelled') AND finished_at < ?
  `).run(new Date(now.getTime() - COMPLETED_RETENTION_MS).toISOString())
  db.prepare(`
    DELETE FROM source_sync_queue
    WHERE status = 'failed' AND finished_at < ?
  `).run(new Date(now.getTime() - FAILED_RETENTION_MS).toISOString())
}

function recoverExpiredSourceRequests(now: Date): number {
  const db = getDb()
  const nowIso = now.toISOString()
  const rows = db.prepare(`
    SELECT id, source_id
    FROM source_sync_queue
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `).all(nowIso) as Array<{ id: string; source_id: string }>
  if (rows.length === 0) return 0

  const recover = db.prepare(`
    UPDATE source_sync_queue
    SET status = 'pending', available_at = ?, updated_at = ?,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error = '执行租约过期，已重新排队'
    WHERE id = ? AND status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `)
  let recovered = 0
  const sourceIds = new Set<string>()
  for (const row of rows) {
    if (recover.run(nowIso, nowIso, row.id, nowIso).changes === 0) continue
    recovered++
    sourceIds.add(row.source_id)
  }
  for (const sourceId of sourceIds) {
    updateSource(sourceId, {
      lastScheduleStatus: 'queued',
      lastScheduleError: '上次执行中断，已重新排队',
    })
  }
  return recovered
}

/** Persist one idempotent Source Convergence Request for every due Playlist Source. */
export function reconcileSourceSchedules(config: AppConfig, now = new Date()): number {
  const db = getDb()
  const nowIso = now.toISOString()
  return db.transaction(() => {
    pruneFinishedRequests(now)
    recoverExpiredSourceRequests(now)
    let enqueued = 0
    const sources = listSources()

    for (const source of sources) {
      if (!source.enabled || !config.sync.enabled) {
        const cancelled = db.prepare(`
          UPDATE source_sync_queue
          SET status = 'cancelled', finished_at = ?, updated_at = ?,
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = '来源或自动同步已停用'
          WHERE source_id = ? AND status = 'pending'
        `).run(nowIso, nowIso, source.id)
        if (
          cancelled.changes > 0
          || source.nextSyncAt !== null
          || source.lastScheduleStatus !== 'idle'
          || source.lastScheduleError !== null
        ) {
          updateSource(source.id, {
            nextSyncAt: null,
            lastScheduleStatus: 'idle',
            lastScheduleError: null,
          })
        }
        continue
      }

      const lastSynced = validDate(source.lastSyncedAt)
      const lastScheduled = validDate(source.lastScheduledAt)
      const manualSyncSupersededFailure = source.lastScheduleStatus === 'failed'
        && lastSynced
        && lastScheduled
        && lastSynced.getTime() > lastScheduled.getTime()
      if (manualSyncSupersededFailure) {
        updateSource(source.id, {
          lastScheduleStatus: 'idle',
          lastScheduleError: null,
        })
      }

      if (source.lastSyncedAt) {
        const superseded = db.prepare(`
          UPDATE source_sync_queue
          SET status = 'cancelled', finished_at = ?, updated_at = ?,
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = '已被较新的手动同步取代'
          WHERE source_id = ? AND status = 'pending' AND created_at <= ?
        `).run(nowIso, nowIso, source.id, source.lastSyncedAt)
        if (superseded.changes > 0) {
          updateSource(source.id, {
            lastScheduleStatus: 'idle',
            lastScheduleError: null,
          })
        }
      }

      const dueAt = nextSourceDueAt(source, config, now)
      const dueIso = dueAt.toISOString()
      if (source.nextSyncAt !== dueIso) updateSource(source.id, { nextSyncAt: dueIso })
      if (dueAt.getTime() > now.getTime()) continue

      const active = db.prepare(`
        SELECT 1 FROM source_sync_queue
        WHERE source_id = ? AND status IN ('pending','running')
        LIMIT 1
      `).get(source.id)
      if (active) continue

      const result = db.prepare(`
        INSERT OR IGNORE INTO source_sync_queue (
          id, source_id, schedule_window, status, available_at,
          attempts, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)
      `).run(randomUUID(), source.id, dueIso, nowIso, nowIso, nowIso)
      if (result.changes > 0) {
        enqueued++
        updateSource(source.id, {
          lastScheduleStatus: 'queued',
          lastScheduledAt: nowIso,
          lastScheduleError: null,
        })
      }
    }
    return enqueued
  })()
}

/** Return interrupted requests to the queue after process restart. */
export function recoverInterruptedSourceRequests(now = new Date()): number {
  const db = getDb()
  const nowIso = now.toISOString()
  const currentOwnerPrefix = `source-scheduler:${process.pid}:%`
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, source_id FROM source_sync_queue
      WHERE status = 'running'
        AND (lease_owner IS NULL OR lease_owner NOT LIKE ?)
    `).all(currentOwnerPrefix) as Array<{ id: string; source_id: string }>
    if (rows.length === 0) return 0
    db.prepare(`
      UPDATE source_sync_queue
      SET status = 'pending', available_at = ?, updated_at = ?,
          lease_owner = NULL, lease_expires_at = NULL,
          last_error = '服务重启后恢复等待'
      WHERE status = 'running'
        AND (lease_owner IS NULL OR lease_owner NOT LIKE ?)
    `).run(nowIso, nowIso, currentOwnerPrefix)
    for (const sourceId of new Set(rows.map(row => row.source_id))) {
      updateSource(sourceId, {
        lastScheduleStatus: 'queued',
        lastScheduleError: '服务重启后恢复等待',
      })
    }
    return rows.length
  })()
}

/** Lease the oldest due request. Only this interface may transition pending -> running. */
export function claimNextSourceRequest(
  leaseOwner: string,
  now = new Date(),
  leaseMs = SOURCE_REQUEST_LEASE_MS,
): SourceConvergenceRequest | null {
  const db = getDb()
  const nowIso = now.toISOString()
  return db.transaction(() => {
    db.prepare(`
      UPDATE source_sync_queue
      SET status = 'cancelled', finished_at = ?, updated_at = ?,
          last_error = '来源已停用'
      WHERE status = 'pending'
        AND source_id IN (SELECT id FROM playlist_sources WHERE enabled = 0)
    `).run(nowIso, nowIso)

    const row = db.prepare(`
      SELECT queue.id, queue.source_id, queue.schedule_window, queue.attempts
      FROM source_sync_queue queue
      JOIN playlist_sources source ON source.id = queue.source_id
      WHERE queue.status = 'pending' AND queue.available_at <= ? AND source.enabled = 1
        AND NOT EXISTS (SELECT 1 FROM source_sync_queue WHERE status = 'running')
      ORDER BY queue.available_at ASC, queue.created_at ASC
      LIMIT 1
    `).get(nowIso) as QueueRow | undefined
    if (!row) return null

    const result = db.prepare(`
      UPDATE OR IGNORE source_sync_queue
      SET status = 'running', lease_owner = ?, lease_expires_at = ?,
          attempts = attempts + 1, started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      leaseOwner,
      new Date(now.getTime() + leaseMs).toISOString(),
      nowIso,
      nowIso,
      row.id,
    )
    if (result.changes === 0) return null
    updateSource(row.source_id, {
      lastScheduleStatus: 'running',
      lastScheduleError: null,
    })
    return {
      id: row.id,
      sourceId: row.source_id,
      scheduleWindow: row.schedule_window,
      attempts: row.attempts + 1,
      leaseOwner,
    }
  })()
}

export function attachSourceRequestRun(request: SourceConvergenceRequest, runId: string): boolean {
  return getDb().prepare(`
    UPDATE source_sync_queue
    SET run_id = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(runId, new Date().toISOString(), request.id, request.leaseOwner).changes > 0
}

export function renewSourceRequestLease(
  requestId: string,
  leaseOwner: string,
  now = new Date(),
  leaseMs = SOURCE_REQUEST_LEASE_MS,
): boolean {
  return getDb().prepare(`
    UPDATE source_sync_queue
    SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(
    new Date(now.getTime() + leaseMs).toISOString(),
    now.toISOString(),
    requestId,
    leaseOwner,
  ).changes > 0
}

export function finishSourceRequest(
  request: SourceConvergenceRequest,
  result: 'success' | 'partial' | 'failure',
  config: AppConfig,
  error: string | null,
  now = new Date(),
): void {
  const db = getDb()
  const nowIso = now.toISOString()
  db.transaction(() => {
    const source = getSource(request.sourceId)
    if (!source) {
      db.prepare(`
        UPDATE source_sync_queue
        SET status = 'cancelled', finished_at = ?, updated_at = ?,
            lease_owner = NULL, lease_expires_at = NULL,
            last_error = '来源已删除'
        WHERE id = ?
      `).run(nowIso, nowIso, request.id)
      return
    }
    const queueStatus: SourceConvergenceRequestStatus = result === 'failure' ? 'failed' : 'completed'
    const nextSyncAt = new Date(
      now.getTime() + effectiveSourceIntervalMinutes(source, config) * 60 * 1000,
    ).toISOString()
    const queueUpdate = db.prepare(`
      UPDATE source_sync_queue
      SET status = ?, run_id = ?, last_error = ?, finished_at = ?, updated_at = ?,
          lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(queueStatus, source.lastJobId, error, nowIso, nowIso, request.id, request.leaseOwner)
    if (queueUpdate.changes === 0) return
    updateSource(source.id, {
      nextSyncAt,
      lastScheduleStatus: result === 'failure' ? 'failed' : result,
      lastScheduledAt: nowIso,
      lastScheduleError: error,
    })
  })()
}

export function getSourceScheduleSnapshot(): SourceScheduleSnapshot {
  const db = getDb()
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS queue_depth,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
      MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_queued_at
    FROM source_sync_queue
  `).get() as { queue_depth: number | null; running_count: number | null; oldest_queued_at: string | null }
  const next = db.prepare(`
    SELECT MIN(next_sync_at) AS next_sync_at
    FROM playlist_sources WHERE enabled = 1 AND next_sync_at IS NOT NULL
  `).get() as { next_sync_at: string | null }
  const failed = db.prepare(`
    SELECT last_schedule_error
    FROM playlist_sources
    WHERE last_schedule_status = 'failed' AND last_schedule_error IS NOT NULL
    ORDER BY last_scheduled_at DESC LIMIT 1
  `).get() as { last_schedule_error: string } | undefined
  return {
    queueDepth: Number(counts.queue_depth ?? 0),
    runningCount: Number(counts.running_count ?? 0),
    oldestQueuedAt: counts.oldest_queued_at,
    nextSyncAt: next.next_sync_at,
    lastError: failed?.last_schedule_error ?? null,
  }
}
