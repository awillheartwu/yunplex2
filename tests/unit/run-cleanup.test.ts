import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import { cleanupRuns, parseRunCleanupRequest, previewRunCleanup } from '../../server/lib/run/cleanup'

const directories: string[] = []

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-cleanup-'))
  directories.push(directory)
  initDb(directory)
}

function insertRun(id: string, startedAt: string, status = 'success', type = 'sync') {
  getDb().prepare(`
    INSERT INTO task_runs (
      id, type, trigger, started_at, finished_at, status, summary,
      total_items, success_items, failed_items, skipped_items, removed_items,
      warnings, source, target, duration_ms, data
    ) VALUES (?, ?, 'system', ?, ?, ?, ?, 1, 1, 0, 0, 0, 0, '', '', 0, '{}')
  `).run(id, type, startedAt, startedAt, status, id)
}

function insertDownloadTask(id: string, runId: string, status: string) {
  getDb().prepare(`
    INSERT INTO download_tasks (
      id, song_id, song_name, artist, status, progress, job_id, run_id, created_at, updated_at
    ) VALUES (?, 1, ?, 'Artist', ?, 100, ?, ?, ?, ?)
  `).run(id, id, status, runId, runId, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')
}

function insertFailure(id: string, runId: string) {
  getDb().prepare(`
    INSERT INTO failure_records (
      id, fingerprint, subject_key, song_id, song_name, artist, source_id, source_name,
      run_id, run_type, failure_kind, failure_reason, status, first_seen_at, last_seen_at,
      occurrence_count, retry_count, download_task_ids
    ) VALUES (?, ?, ?, 1, ?, 'Artist', NULL, '', ?, 'sync', 'failed_download', 'failed', 'open', ?, ?, 1, 0, '[]')
  `).run(id, id, id, id, runId, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')
}

describe('run cleanup preview', () => {
  afterEach(() => {
    closeDb()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('validates cleanup filters', () => {
    expect(parseRunCleanupRequest({ before: 'bad-date' })).toEqual({ ok: false, message: '请选择有效的清理日期' })
    expect(parseRunCleanupRequest({ from: '2026-06-10', to: '2026-06-01' })).toEqual({ ok: false, message: '开始日期不能晚于结束日期' })
    expect(parseRunCleanupRequest({ before: '2026-06-01', status: 'running' })).toEqual({ ok: false, message: '运行中的记录不能清理' })
  })

  it('previews and cleans only matching non-running runs', () => {
    setup()
    insertRun('old-success', '2026-05-01T00:00:00.000Z', 'success', 'sync')
    insertRun('old-failed', '2026-05-02T00:00:00.000Z', 'failed', 'manual_download')
    insertRun('old-running', '2026-05-03T00:00:00.000Z', 'running', 'sync')
    insertRun('new-success', '2026-07-01T00:00:00.000Z', 'success', 'sync')
    insertDownloadTask('done-task', 'old-success', 'done')
    insertDownloadTask('failed-task', 'old-success', 'failed')
    insertDownloadTask('pending-task', 'old-success', 'pending')
    insertFailure('failure-one', 'old-success')

    expect(previewRunCleanup({ before: '2026-06-01' })).toEqual({
      runCount: 2,
      downloadTaskCount: 2,
      linkedFailureCount: 1,
    })
    expect(previewRunCleanup({ before: '2026-06-01', type: 'manual_download' })).toMatchObject({ runCount: 1 })
    expect(previewRunCleanup({ before: '2026-06-01', status: 'success' })).toMatchObject({ runCount: 1 })

    const result = cleanupRuns({ before: '2026-06-01' })
    expect(result).toMatchObject({ count: 2, runCount: 2, downloadTaskCount: 2, linkedFailureCount: 1 })
    expect(getDb().prepare('SELECT id FROM task_runs ORDER BY id').all()).toEqual([{ id: 'new-success' }, { id: 'old-running' }])
    expect(getDb().prepare('SELECT id FROM failure_records').all()).toEqual([{ id: 'failure-one' }])
  })

  it('previews and cleans runs inside an inclusive date range', () => {
    setup()
    insertRun('before-range', '2026-06-08T23:59:59.000Z', 'success', 'sync')
    insertRun('range-start', '2026-06-09T00:00:00.000Z', 'success', 'sync')
    insertRun('range-end', '2026-06-25T23:59:59.000Z', 'failed', 'manual_download')
    insertRun('after-range', '2026-06-26T00:00:00.000Z', 'success', 'sync')
    insertRun('range-running', '2026-06-10T12:00:00.000Z', 'running', 'sync')

    expect(previewRunCleanup({ from: '2026-06-09', to: '2026-06-25', timeZone: 'UTC' })).toMatchObject({
      runCount: 2,
    })
    expect(previewRunCleanup({ from: '2026-06-09', to: '2026-06-25', type: 'manual_download', timeZone: 'UTC' })).toMatchObject({
      runCount: 1,
    })

    cleanupRuns({ from: '2026-06-09', to: '2026-06-25', timeZone: 'UTC' })
    expect(getDb().prepare('SELECT id FROM task_runs ORDER BY id').all()).toEqual([
      { id: 'after-range' },
      { id: 'before-range' },
      { id: 'range-running' },
    ])
  })
})
