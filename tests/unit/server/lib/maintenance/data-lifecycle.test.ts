import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import type { JobStatus, TaskRun } from '~~/server/lib/job/types'
import { getRun, saveRun } from '~~/server/lib/run/store'
import {
  DATA_LIFECYCLE_LIMITS,
  resolveDataLifecyclePolicy,
  runDataLifecycleMaintenance,
} from '~~/server/lib/maintenance/data-lifecycle'

const directories: string[] = []
const NOW = new Date('2026-08-23T12:00:00.000Z')
const config = {
  logRetentionDays: 30,
  jobRetentionSuccessDays: 7,
  jobRetentionFailedDays: 90,
  downloadTaskRetentionDays: 30,
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-lifecycle-'))
  directories.push(directory)
  initDb(directory)
}

function insertRun(id: string, startedAt: string, status: Exclude<JobStatus, 'awaiting_action'>, songs = 2) {
  const data: TaskRun = {
    id,
    type: 'sync',
    trigger: 'system',
    startedAt,
    finishedAt: startedAt,
    status,
    durationMs: 1000,
    summary: id,
    source: 'source',
    sourceIds: ['source-one'],
    target: 'Plex',
    totalSongs: songs,
    successSongs: status === 'success' ? songs : 0,
    failedSongs: status === 'failed' || status === 'partial' ? songs : 0,
    skippedSongs: 0,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    steps: [{
      id: `${id}:step`, type: 'download', title: 'step', status,
      startedAt, finishedAt: startedAt, durationMs: 1000, message: id, children: [],
    }],
    songs: Array.from({ length: songs }, (_, index) => ({
      id: `${id}:song:${index}`,
      songName: `Song ${index}`,
      artist: 'Artist',
      album: 'Album',
      status: status === 'success' ? 'success' : 'failed_download',
      phase: status === 'success' ? 'done' : 'download',
      error: { title: 'failed', message: 'large diagnostic payload'.repeat(100), stage: 'download' },
    })),
    config: { server: 'http://plex.local', section: 'Music' },
  }
  saveRun(data)
}

function insertDownloadTask(id: string, status: 'done' | 'failed', updatedAt: string) {
  getDb().prepare(`
    INSERT INTO download_tasks (
      id, song_id, song_name, artist, status, progress, created_at, updated_at
    ) VALUES (?, 1, ?, 'Artist', ?, 100, ?, ?)
  `).run(id, id, status, updatedAt, updatedAt)
}

function insertFailure(input: {
  id: string
  fingerprint: string
  status: 'open' | 'ignored' | 'resolved'
  runId?: string | null
  resolvedAt?: string | null
  taskIds?: string[]
}) {
  getDb().prepare(`
    INSERT INTO failure_records (
      id, fingerprint, subject_key, song_id, song_name, artist, source_id,
      source_name, run_id, run_type, failure_kind, failure_reason, status,
      first_seen_at, last_seen_at, ignored_at, resolved_at,
      occurrence_count, retry_count, download_task_ids
    ) VALUES (?, ?, ?, 1, 'Song', 'Artist', NULL, '', ?, 'sync',
      'failed_download', 'failed', ?, '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z', NULL, ?, 100, 0, ?)
  `).run(
    input.id,
    input.fingerprint,
    input.fingerprint,
    input.runId ?? null,
    input.status,
    input.resolvedAt ?? null,
    input.taskIds?.join(',') ?? null,
  )
}

describe('automatic data lifecycle maintenance', () => {
  afterEach(() => {
    closeDb()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('caps legacy settings so operational data cannot remain unbounded', () => {
    expect(resolveDataLifecyclePolicy(config)).toEqual(DATA_LIFECYCLE_LIMITS)
    expect(resolveDataLifecyclePolicy({
      logRetentionDays: 365,
      jobRetentionSuccessDays: 365,
      jobRetentionFailedDays: 365,
      downloadTaskRetentionDays: 0,
    })).toEqual(DATA_LIFECYCLE_LIMITS)
  })

  it('keeps diagnostic logs within one centralized age and row budget', () => {
    setup()
    const insert = getDb().prepare(`
      INSERT INTO logs (id, timestamp, level, message, detail, stage)
      VALUES (?, ?, 'warn', ?, NULL, 'maintenance')
    `)
    for (let index = 0; index < 5; index += 1) {
      insert.run(`old-${index}`, '2026-07-01T00:00:00.000Z', `old ${index}`)
    }
    for (let index = 0; index < 2005; index += 1) {
      insert.run(
        `recent-${String(index).padStart(4, '0')}`,
        `2026-08-22T${String(index % 24).padStart(2, '0')}:00:${String(index % 60).padStart(2, '0')}.000Z`,
        `recent ${index}`,
      )
    }

    const result = runDataLifecycleMaintenance(config, getDb(), NOW)
    const rows = getDb().prepare('SELECT COUNT(*) AS count, MIN(timestamp) AS oldest FROM logs').get() as {
      count: number
      oldest: string
    }

    expect(result.deletedLogs).toBe(10)
    expect(rows.count).toBe(DATA_LIFECYCLE_LIMITS.logMaxRows)
    expect(rows.oldest >= '2026-08-22T00:00:00.000Z').toBe(true)
  })

  it('compacts detail, removes expired summaries, and preserves protected facts', () => {
    setup()
    insertRun('recent-failed', '2026-08-20T12:00:00.000Z', 'failed')
    insertRun('compact-failed', '2026-08-14T12:00:00.000Z', 'partial')
    insertRun('expired-failed', '2026-08-01T12:00:00.000Z', 'failed')
    insertRun('expired-success', '2026-08-10T12:00:00.000Z', 'success')
    insertRun('old-running', '2026-01-01T00:00:00.000Z', 'running')

    getDb().prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, last_job_id, created_at, updated_at
      ) VALUES ('source-one', 1, 'Source', 'expired-failed', ?, ?)
    `).run(NOW.toISOString(), NOW.toISOString())
    insertFailure({
      id: 'open-failure',
      fingerprint: 'open-fingerprint',
      status: 'open',
      runId: 'expired-failed',
    })
    getDb().prepare(`
      INSERT INTO local_media_assets (
        netease_song_id, file_path, provenance, ownership, status,
        evidence_json, created_at, updated_at
      ) VALUES (1, '/music/song.flac', 'manual', 'external', 'active', '{}', ?, ?)
    `).run(NOW.toISOString(), NOW.toISOString())
    getDb().prepare(`
      INSERT INTO song_identity_bindings (
        netease_song_id, plex_file_path, binding_method, status,
        evidence_json, created_at, updated_at
      ) VALUES (1, '/music/song.flac', 'manual', 'active', '{}', ?, ?)
    `).run(NOW.toISOString(), NOW.toISOString())

    const result = runDataLifecycleMaintenance(config, getDb(), NOW)

    expect(result).toMatchObject({ compactedRuns: 1, deletedRuns: 2, clearedRunReferences: 2 })
    expect(getRun('recent-failed')?.detailsExpired).toBe(false)
    expect(getRun('compact-failed')).toMatchObject({ detailsExpired: true, songs: [], steps: [] })
    expect(getRun('expired-failed')).toBeNull()
    expect(getRun('expired-success')).toBeNull()
    expect(getRun('old-running')?.status).toBe('running')
    expect(getDb().prepare("SELECT last_job_id FROM playlist_sources WHERE id = 'source-one'").get()).toEqual({ last_job_id: null })
    expect(getDb().prepare("SELECT run_id, status FROM failure_records WHERE id = 'open-failure'").get()).toEqual({ run_id: null, status: 'open' })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM local_media_assets').get()).toEqual({ count: 1 })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM song_identity_bindings').get()).toEqual({ count: 1 })

    expect(runDataLifecycleMaintenance(config, getDb(), NOW).compactedRuns).toBe(0)
  })

  it('caps recent failed and partial detail by bytes when scheduled runs are frequent', () => {
    setup()
    const payload = 'diagnostic'.repeat(120_000)
    for (let index = 0; index < 10; index += 1) {
      const id = `frequent-${String(index).padStart(2, '0')}`
      const startedAt = `2026-08-22T${String(index).padStart(2, '0')}:00:00.000Z`
      insertRun(id, startedAt, 'partial')
      getDb().prepare('UPDATE task_run_song_changes SET error_json = ? WHERE run_id = ?')
        .run(JSON.stringify({ title: 'failed', message: payload, stage: 'download' }), id)
    }

    const result = runDataLifecycleMaintenance(config, getDb(), NOW)
    const retained = getDb().prepare(`
      SELECT COUNT(*) AS rows, COALESCE(SUM(payload_bytes), 0) AS bytes
      FROM (
        SELECT task_runs.id,
          LENGTH(CAST(task_runs.steps_json AS BLOB))
          + COALESCE(SUM(LENGTH(CAST(COALESCE(change.error_json, '') AS BLOB))), 0) AS payload_bytes
        FROM task_runs
        LEFT JOIN task_run_song_changes change ON change.run_id = task_runs.id
        WHERE task_runs.details_expired = 0
        GROUP BY task_runs.id
      )
    `).get() as { rows: number; bytes: number }

    expect(result.compactedRuns).toBeGreaterThan(0)
    expect(retained.rows).toBeGreaterThan(0)
    expect(retained.bytes).toBeLessThanOrEqual(DATA_LIFECYCLE_LIMITS.runDetailMaxBytes)
    expect(getRun('frequent-09')?.detailsExpired).toBe(false)
    expect(getRun('frequent-00')).toMatchObject({ detailsExpired: true, songs: [], steps: [] })
  })

  it('bounds failure history and keeps retry inputs for unresolved failures', () => {
    setup()
    const oldDate = '2026-07-01T00:00:00.000Z'
    insertDownloadTask('protected-task', 'failed', oldDate)
    insertDownloadTask('stale-failed-task', 'failed', oldDate)
    insertDownloadTask('stale-done-task', 'done', oldDate)
    insertFailure({
      id: 'open-failure',
      fingerprint: 'open-fingerprint',
      status: 'open',
      taskIds: ['protected-task', 'missing-task'],
    })
    insertFailure({
      id: 'resolved-failure',
      fingerprint: 'resolved-fingerprint',
      status: 'resolved',
      resolvedAt: '2026-07-01T00:00:00.000Z',
      taskIds: ['stale-failed-task'],
    })
    for (let index = 0; index < 60; index += 1) {
      getDb().prepare(`
        INSERT INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
        VALUES ('open-fingerprint', ?, ?)
      `).run(`occurrence-${String(index).padStart(2, '0')}`, `2026-08-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z`)
    }
    getDb().prepare(`
      INSERT INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
      VALUES ('resolved-fingerprint', 'resolved-occurrence', '2026-07-01T00:00:00.000Z')
    `).run()

    const result = runDataLifecycleMaintenance(config, getDb(), NOW)

    expect(result.deletedDownloadTasks).toBe(2)
    expect(result.prunedFailureTaskReferences).toBe(2)
    expect(result.deletedResolvedFailures).toBe(1)
    expect(getDb().prepare('SELECT id FROM download_tasks').all()).toEqual([{ id: 'protected-task' }])
    expect(getDb().prepare("SELECT download_task_ids, occurrence_count FROM failure_records WHERE id = 'open-failure'").get()).toEqual({
      download_task_ids: 'protected-task',
      occurrence_count: 100,
    })
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM failure_occurrences WHERE fingerprint = 'open-fingerprint'").get()).toEqual({ count: 50 })
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM failure_occurrences WHERE fingerprint = 'resolved-fingerprint'").get()).toEqual({ count: 0 })
  })
})
