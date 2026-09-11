import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import {
  createManualDownloadRun,
  createRepairRun,
  getRun,
  listRuns,
  saveRun,
  syncManualDownloadRun,
  recoverInterruptedRuns,
} from '../../server/lib/run/store'
import type { TaskRun } from '../../server/lib/job/types'

const directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-runs-'))
  directories.push(directory)
  initDb(directory)
}

function statusRun(id: string, status: TaskRun['status']): TaskRun {
  const startedAt = '2026-06-22T00:00:00.000Z'
  return {
    id,
    type: 'source_initialization',
    trigger: 'user',
    startedAt,
    finishedAt: status === 'running' || status === 'awaiting_action' ? null : startedAt,
    status,
    durationMs: 0,
    summary: id,
    source: '来源',
    sourceIds: [`${id}-source`],
    target: 'Plex',
    totalSongs: 0,
    successSongs: 0,
    failedSongs: 0,
    skippedSongs: 0,
    removedSongs: 0,
    warnings: 0,
    dryRun: true,
    steps: [],
    songs: [],
    config: {},
  }
}

function replaceTaskRunsWithLegacyStatusCheck() {
  const db = getDb()
  db.pragma('foreign_keys = OFF')
  db.exec(`
    DROP INDEX IF EXISTS idx_task_runs_started;
    DROP INDEX IF EXISTS idx_task_runs_status;
    DROP INDEX IF EXISTS idx_task_runs_type;
    CREATE TABLE task_runs_legacy (
      id             TEXT PRIMARY KEY,
      type           TEXT NOT NULL,
      trigger        TEXT NOT NULL DEFAULT 'system',
      started_at     TEXT NOT NULL,
      finished_at    TEXT,
      status         TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','cancelled')),
      summary        TEXT NOT NULL DEFAULT '',
      total_items    INTEGER NOT NULL DEFAULT 0,
      success_items  INTEGER NOT NULL DEFAULT 0,
      failed_items   INTEGER NOT NULL DEFAULT 0,
      skipped_items  INTEGER NOT NULL DEFAULT 0,
      removed_items  INTEGER NOT NULL DEFAULT 0,
      warnings       INTEGER NOT NULL DEFAULT 0,
      source         TEXT NOT NULL DEFAULT '',
      target         TEXT NOT NULL DEFAULT '',
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      dry_run        INTEGER NOT NULL DEFAULT 0,
      details_expired INTEGER NOT NULL DEFAULT 0,
      steps_json     TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO task_runs_legacy SELECT * FROM task_runs;
    DROP TABLE task_runs;
    ALTER TABLE task_runs_legacy RENAME TO task_runs;
    CREATE INDEX idx_task_runs_started ON task_runs(started_at DESC);
    CREATE INDEX idx_task_runs_status ON task_runs(status);
    CREATE INDEX idx_task_runs_type ON task_runs(type);
  `)
  db.pragma('foreign_keys = ON')
}

function insertInitialization(runId: string, sourceId: string, status: 'awaiting_review' | 'completed') {
  const now = new Date().toISOString()
  const playlistId = (getDb().prepare('SELECT COALESCE(MAX(netease_playlist_id), 0) + 1 AS id FROM playlist_sources').get() as { id: number }).id
  getDb().prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sourceId, playlistId, sourceId, now, now)
  getDb().prepare(`
    INSERT INTO source_initializations (id, source_id, run_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`${runId}-initialization`, sourceId, runId, status, now, now)
}

describe('task run store', () => {
  afterEach(() => {
    closeDb()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('does not create the legacy jobs table for new databases', () => {
    setup()

    const tables = getDb().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jobs', 'task_runs', 'failure_records')
    `).all() as Array<{ name: string }>

    expect(tables.map(table => table.name).sort()).toEqual(['failure_records', 'task_runs'])
    expect(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'").get()).toBeUndefined()
  })

  it('persists and completes a manual download run from its task results', () => {
    setup()
    createManualDownloadRun({ id: 'batch-1', total: 2, sourceLabel: '两首单曲' })
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        file_path, file_type, error, job_id, run_id, created_at, updated_at
      ) VALUES
        ('one', NULL, 1, 'One', 'A', 'X', 'done', 100, NULL, NULL, NULL, 'batch-1', 'batch-1', ?, ?),
        ('two', NULL, 2, 'Two', 'B', 'Y', 'failed', 0, '/tmp/music/two.flac', 'flac', '标签写入失败: EIO', 'batch-1', 'batch-1', ?, ?)
    `).run(now, now, now, now)

    const run = syncManualDownloadRun('batch-1')
    expect(run).toMatchObject({
      type: 'manual_download',
      status: 'partial',
      totalSongs: 2,
      successSongs: 1,
      failedSongs: 1,
    })
    expect(run?.songs).toHaveLength(2)
    expect(run?.songs[1]).toMatchObject({
      id: 'two',
      status: 'failed_tags',
      phase: 'tags',
      filePath: '/tmp/music/two.flac',
      fileType: 'flac',
      error: {
        title: '标签写入失败',
        stage: 'tags',
      },
    })
    expect(getRun('batch-1')).toMatchObject({
      status: 'partial',
      songs: [{ id: 'one' }, { id: 'two' }],
      steps: [{ id: 'batch-1:download', status: 'partial' }],
    })
  })

  it('returns interrupted manual downloads to pending for the persistent worker', () => {
    setup()
    createManualDownloadRun({ id: 'batch-interrupted', total: 2, sourceLabel: '两首单曲' })
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, created_at, updated_at
      ) VALUES
        ('downloading-one', NULL, 11, 'One', 'A', 'X', 'downloading', 50, 'batch-interrupted', 'batch-interrupted', ?, ?),
        ('tagging-two', NULL, 12, 'Two', 'B', 'Y', 'tagging', 90, 'batch-interrupted', 'batch-interrupted', ?, ?)
    `).run(now, now, now, now)

    expect(recoverInterruptedRuns()).toBeGreaterThanOrEqual(2)

    const rows = getDb().prepare('SELECT id, status, progress, error FROM download_tasks ORDER BY id').all() as Array<{
      id: string
      status: string
      progress: number
      error: string | null
    }>
    expect(rows).toEqual([
      { id: 'downloading-one', status: 'pending', progress: 0, error: null },
      { id: 'tagging-two', status: 'pending', progress: 0, error: null },
    ])
    expect(getRun('batch-interrupted')).toMatchObject({ status: 'running' })
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count).toBe(0)
  })

  it('keeps source-aware manual download recovery classified as manual_download', () => {
    setup()
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-one', 1001, '来源一', ?, ?)
    `).run(now, now)
    createManualDownloadRun({
      id: 'managed-interrupted',
      total: 1,
      sourceLabel: '来源一 · 下载并托管',
      sourceIds: ['source-one'],
    })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, created_at, updated_at
      ) VALUES ('managed-task', 'source-one', 31, 'Managed', 'A', 'X', 'downloading', 50,
        'managed-interrupted', 'managed-interrupted', ?, ?)
    `).run(now, now)

    recoverInterruptedRuns()

    expect(getDb().prepare(`
      SELECT source_id, status FROM download_tasks WHERE song_id = 31
    `).get()).toEqual({ source_id: 'source-one', status: 'pending' })
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count).toBe(0)
  })

  it('returns interrupted Media Repair Commands to pending without recording a failure', () => {
    setup()
    const now = new Date().toISOString()
    createRepairRun({
      id: 'repair-interrupted',
      total: 1,
      skipped: 0,
      sourceId: 'source-one',
      sourceLabel: '来源一',
    })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, operation, target_path, created_at, updated_at
      ) VALUES (
        'repair-task', 'source-one', 41, 'Repair', 'A', 'X', 'tagging', 90,
        'repair-interrupted', 'repair-interrupted', 'repair_existing',
        '/tmp/music/repair.flac', ?, ?
      )
    `).run(now, now)

    recoverInterruptedRuns()

    expect(getDb().prepare(`
      SELECT status, progress, error, lease_owner, lease_expires_at
      FROM download_tasks WHERE id = 'repair-task'
    `).get()).toEqual({
      status: 'pending',
      progress: 0,
      error: null,
      lease_owner: null,
      lease_expires_at: null,
    })
    expect(getRun('repair-interrupted')).toMatchObject({
      status: 'running',
      summary: '补全资源进行中：成功 0 首，待处理 1 首',
    })
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count).toBe(0)
  })

  it('leaves terminal repair downloads recoverable until post-processing runs', () => {
    setup()
    const now = new Date().toISOString()
    createRepairRun({
      id: 'repair-postprocess',
      total: 1,
      skipped: 0,
      sourceId: 'source-one',
      sourceLabel: '来源一',
    })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, operation, target_path, created_at, updated_at
      ) VALUES (
        'repair-done', 'source-one', 42, 'Repair done', 'A', 'X', 'done', 100,
        'repair-postprocess', 'repair-postprocess', 'repair_existing',
        '/tmp/music/repair-done.flac', ?, ?
      )
    `).run(now, now)

    recoverInterruptedRuns()

    expect(getRun('repair-postprocess')).toMatchObject({ status: 'running' })
  })

  it('marks an interrupted scheduled convergence as cancelled rather than failed', () => {
    setup()
    const startedAt = new Date(Date.now() - 1000).toISOString()
    saveRun({
      id: 'scheduled-interrupted',
      type: 'sync',
      trigger: 'schedule',
      startedAt,
      finishedAt: null,
      status: 'running',
      durationMs: 0,
      summary: '',
      source: '网易云音乐',
      sourceIds: ['source-one'],
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

    recoverInterruptedRuns()

    expect(getRun('scheduled-interrupted')).toMatchObject({
      status: 'cancelled',
      summary: '服务重启，已交由自动调度重新执行',
    })
  })

  it('does not cancel a scheduled run that still owns a valid queue lease', () => {
    setup()
    const now = new Date()
    const startedAt = new Date(now.getTime() - 1000).toISOString()
    const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-one', 1001, '来源一', ?, ?)
    `).run(startedAt, startedAt)
    saveRun({
      id: 'scheduled-active', type: 'sync', trigger: 'schedule', startedAt,
      finishedAt: null, status: 'running', durationMs: 0, summary: '',
      source: '网易云音乐', sourceIds: ['source-one'], target: 'Plex',
      totalSongs: 0, successSongs: 0, failedSongs: 0, skippedSongs: 0,
      removedSongs: 0, warnings: 0, dryRun: false, steps: [], songs: [], config: {},
    })
    getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at, lease_owner,
        lease_expires_at, attempts, run_id, created_at, updated_at, started_at
      ) VALUES ('request-one', 'source-one', ?, 'running', ?, 'source-scheduler:1:test',
        ?, 1, 'scheduled-active', ?, ?, ?)
    `).run(startedAt, startedAt, leaseExpiresAt, startedAt, startedAt, startedAt)

    recoverInterruptedRuns()

    expect(getRun('scheduled-active')?.status).toBe('running')
  })

  it('keeps a user run with a valid queue lease recoverable', () => {
    setup()
    const now = new Date()
    const startedAt = new Date(now.getTime() - 1000).toISOString()
    const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-one', 1001, '来源一', ?, ?)
    `).run(startedAt, startedAt)
    saveRun({
      id: 'user-active', type: 'sync', trigger: 'user', startedAt,
      finishedAt: null, status: 'running', durationMs: 0, summary: '',
      source: '网易云音乐', sourceIds: ['source-one'], target: 'Plex',
      totalSongs: 0, successSongs: 0, failedSongs: 0, skippedSongs: 0,
      removedSongs: 0, warnings: 0, dryRun: false, steps: [], songs: [], config: {},
    })
    getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at, request_kind,
        trigger, lease_owner, lease_expires_at, attempts, run_id, created_at,
        updated_at, started_at
      ) VALUES ('user-request', 'source-one', ?, 'running', ?, 'convergence',
        'user', 'source-scheduler:1:test', ?, 1, 'user-active', ?, ?, ?)
    `).run(startedAt, startedAt, leaseExpiresAt, startedAt, startedAt, startedAt)

    recoverInterruptedRuns()

    expect(getRun('user-active')?.status).toBe('running')
  })

  it('keeps a source initialization run running while its analysis request is pending', () => {
    setup()
    const startedAt = new Date(Date.now() - 1000).toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-one', 1001, '来源一', ?, ?)
    `).run(startedAt, startedAt)
    saveRun({
      id: 'analysis-pending', type: 'source_initialization', trigger: 'user', startedAt,
      finishedAt: null, status: 'running', durationMs: 0, summary: '正在分析',
      source: '来源一', sourceIds: ['source-one'], target: 'Plex',
      totalSongs: 0, successSongs: 0, failedSongs: 0, skippedSongs: 0,
      removedSongs: 0, warnings: 0, dryRun: true, steps: [], songs: [], config: {},
    })
    getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at, request_kind,
        trigger, run_id, created_at, updated_at
      ) VALUES ('analysis-request', 'source-one', ?, 'pending', ?, 'analysis',
        'user', 'analysis-pending', ?, ?)
    `).run(startedAt, startedAt, startedAt, startedAt)

    expect(recoverInterruptedRuns()).toBe(0)
    expect(getRun('analysis-pending')).toMatchObject({ status: 'running', finishedAt: null })
    expect(getDb().prepare('SELECT status FROM source_sync_queue WHERE id = ?').get('analysis-request'))
      .toEqual({ status: 'pending' })
  })

  it('filters unified runs by type', () => {
    setup()
    createManualDownloadRun({ id: 'batch-1', total: 1, sourceLabel: '单曲' })
    expect(listRuns({ type: 'manual_download' }).items).toHaveLength(1)
    expect(getRun('batch-1')?.trigger).toBe('user')
  })

  it('filters runs that include a source, including zero-result runs', () => {
    setup()
    const baseRun: TaskRun = {
      id: 'run-with-source',
      type: 'sync',
      trigger: 'user',
      startedAt: '2026-06-22T00:00:00.000Z',
      finishedAt: '2026-06-22T00:00:01.000Z',
      status: 'success',
      durationMs: 1000,
      summary: '没有歌曲变化',
      source: '网易云音乐',
      sourceIds: ['source-a', 'source-b'],
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
    }
    saveRun(baseRun)
    saveRun({ ...baseRun, id: 'other-run', sourceIds: ['source-c'] })

    expect(listRuns({ sourceId: 'source-a' }).items.map(run => run.id)).toEqual(['run-with-source'])
    expect(listRuns({ sourceId: 'source-b' }).items.map(run => run.id)).toEqual(['run-with-source'])
    expect(listRuns({ sourceId: 'missing' }).items).toHaveLength(0)
  })

  it('derives source membership from song results for compatible callers', () => {
    setup()
    const run: TaskRun = {
      id: 'song-derived-run',
      type: 'sync',
      trigger: 'system',
      startedAt: '2026-06-22T00:00:00.000Z',
      finishedAt: '2026-06-22T00:00:01.000Z',
      status: 'success',
      durationMs: 1000,
      summary: '同步完成',
      source: '网易云音乐',
      target: 'Plex',
      totalSongs: 1,
      successSongs: 1,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [],
      songs: [{
        id: 'song-1',
        sourceId: 'source-from-song',
        songName: 'Song',
        artist: 'Artist',
        album: 'Album',
        status: 'success',
        phase: 'done',
      }],
      config: {},
    }
    saveRun(run)

    expect(listRuns({ sourceId: 'source-from-song' }).items.map(item => item.id)).toEqual(['song-derived-run'])
  })

  it('persists only changed and exceptional songs after a terminal run', () => {
    setup()
    const run: TaskRun = {
      id: 'sparse-run',
      type: 'sync',
      trigger: 'schedule',
      startedAt: '2026-06-22T00:00:00.000Z',
      finishedAt: '2026-06-22T00:00:01.000Z',
      status: 'partial',
      durationMs: 1000,
      summary: '同步完成，1 首失败',
      source: '网易云音乐',
      sourceIds: ['source-a'],
      target: 'Plex',
      totalSongs: 3,
      successSongs: 1,
      failedSongs: 1,
      skippedSongs: 1,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [],
      songs: [
        { id: 'changed', sourceId: 'source-a', songName: 'Changed', artist: 'A', album: 'X', status: 'success', phase: 'done' },
        { id: 'unchanged', sourceId: 'source-a', songName: 'Unchanged', artist: 'B', album: 'Y', status: 'skipped_existing', phase: 'done' },
        { id: 'failed', sourceId: 'source-a', songName: 'Failed', artist: 'C', album: 'Z', status: 'failed_download', phase: 'download' },
      ],
      config: {},
    }

    saveRun({ ...run, status: 'running', finishedAt: null })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task_run_song_changes').get()).toEqual({ count: 0 })

    saveRun(run)
    expect(getDb().prepare('SELECT item_id, status FROM task_run_song_changes ORDER BY item_id').all()).toEqual([
      { item_id: 'changed', status: 'success' },
      { item_id: 'failed', status: 'failed_download' },
    ])
    expect(getRun(run.id)).toMatchObject({
      totalSongs: 3,
      skippedSongs: 1,
      songs: [
        { id: 'changed', status: 'success' },
        { id: 'failed', status: 'failed_download' },
      ],
    })
  })

  it('filters calendar dates in the client time zone with an inclusive end date', () => {
    setup()
    const run = (id: string, startedAt: string): TaskRun => ({
      id,
      type: 'sync',
      trigger: 'schedule',
      startedAt,
      finishedAt: startedAt,
      status: 'success',
      durationMs: 0,
      summary: id,
      source: '网易云音乐',
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
    saveRun(run('before-local-day', '2026-06-21T15:59:59.999Z'))
    saveRun(run('start-local-day', '2026-06-21T16:00:00.000Z'))
    saveRun(run('end-local-day', '2026-06-22T15:59:59.999Z'))
    saveRun(run('after-local-day', '2026-06-22T16:00:00.000Z'))

    expect(listRuns({
      from: '2026-06-22',
      to: '2026-06-22',
      timeZone: 'Asia/Shanghai',
    }).items.map(item => item.id)).toEqual(['end-local-day', 'start-local-day'])
  })

  it('searches user-facing run fields without matching unrelated config snapshot text', () => {
    setup()
    const now = '2026-06-22T00:00:00.000Z'
    getDb().prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, netease_playlist_name, created_at, updated_at
      ) VALUES
        ('rock-source', 1, '华语摇滚任务', '华语摇滚', ?, ?),
        ('other-source', 2, '其他任务', '其他歌单', ?, ?)
    `).run(now, now, now, now)
    const base: TaskRun = {
      id: 'rock-run',
      type: 'sync',
      trigger: 'user',
      startedAt: now,
      finishedAt: now,
      status: 'success',
      durationMs: 0,
      summary: '同步完成',
      source: '网易云音乐',
      sourceIds: ['rock-source'],
      target: 'Plex',
      totalSongs: 1,
      successSongs: 1,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [],
      songs: [{
        id: 'song',
        sourceId: 'rock-source',
        songName: '艾蜜莉',
        artist: '回春丹',
        album: '艾蜜莉',
        status: 'success',
        phase: 'done',
      }],
      config: {},
    }
    saveRun(base)
    saveRun({
      ...base,
      id: 'unrelated-run',
      sourceIds: ['other-source'],
      songs: [],
      config: { section: '配置快照提到华语摇滚，但本轮未包含该来源' },
    })

    expect(listRuns({ search: '华语摇滚' }).items.map(item => item.id)).toEqual(['rock-run'])
    expect(listRuns({ search: '回春丹' }).items.map(item => item.id)).toEqual(['rock-run'])
  })

  it('projects native and legacy awaiting action statuses consistently across detail, filters, and totals', () => {
    const nativeDirectory = mkdtempSync(join(tmpdir(), 'reyunplex-runs-native-'))
    directories.push(nativeDirectory)
    initDb(nativeDirectory)
    saveRun(statusRun('native-awaiting', 'awaiting_action'))

    expect(getRun('native-awaiting')?.status).toBe('awaiting_action')
    expect(listRuns({ status: 'awaiting_action' })).toMatchObject({
      total: 1,
      items: [{ id: 'native-awaiting', status: 'awaiting_action' }],
    })
    expect(listRuns({ status: 'partial' }).total).toBe(0)

    closeDb()
    const legacyDirectory = mkdtempSync(join(tmpdir(), 'reyunplex-runs-legacy-'))
    directories.push(legacyDirectory)
    initDb(legacyDirectory)
    replaceTaskRunsWithLegacyStatusCheck()

    const legacyAwaiting = statusRun('legacy-awaiting', 'awaiting_action')
    insertInitialization(legacyAwaiting.id, 'legacy-awaiting-source', 'awaiting_review')
    saveRun(legacyAwaiting)
    const truePartial = statusRun('legacy-partial', 'partial')
    insertInitialization(truePartial.id, 'legacy-partial-source', 'completed')
    saveRun(truePartial)

    expect(getDb().prepare('SELECT status FROM task_runs ORDER BY id').all()).toEqual([
      { status: 'partial' },
      { status: 'partial' },
    ])
    expect(getRun('legacy-awaiting')?.status).toBe('awaiting_action')
    expect(listRuns().items.map(item => [item.id, item.status]).sort(([a], [b]) => a!.localeCompare(b!))).toEqual([
      ['legacy-awaiting', 'awaiting_action'],
      ['legacy-partial', 'partial'],
    ])
    expect(listRuns({ status: 'awaiting_action' })).toMatchObject({
      total: 1,
      items: [{ id: 'legacy-awaiting', status: 'awaiting_action' }],
    })
    expect(listRuns({ status: 'partial' })).toMatchObject({
      total: 1,
      items: [{ id: 'legacy-partial', status: 'partial' }],
    })

    closeDb()
    const switchedNativeDirectory = mkdtempSync(join(tmpdir(), 'reyunplex-runs-native-switched-'))
    directories.push(switchedNativeDirectory)
    initDb(switchedNativeDirectory)
    saveRun(statusRun('native-after-legacy', 'awaiting_action'))
    expect(getDb().prepare('SELECT status FROM task_runs WHERE id = ?').get('native-after-legacy')).toEqual({ status: 'awaiting_action' })
    expect(getRun('native-after-legacy')?.status).toBe('awaiting_action')
  })

  it('projects live manual download sync state in detail and list without persisting stale labels', () => {
    setup()
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, requires_match_reconcile, created_at, updated_at
      ) VALUES ('download-source', 2001, '下载来源', 1, ?, ?)
    `).run(now, now)
    saveRun({
      id: 'download-complete', type: 'manual_download', trigger: 'user',
      startedAt: now, finishedAt: now, status: 'success', durationMs: 1000,
      summary: '手动下载完成', source: '下载来源 · 下载并托管', sourceIds: ['download-source'],
      target: '本地磁盘', totalSongs: 1, successSongs: 1, failedSongs: 0, skippedSongs: 0,
      removedSongs: 0, warnings: 0, dryRun: false, steps: [], songs: [], config: {},
    })
    getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at, request_kind,
        trigger, run_id, created_at, updated_at
      ) VALUES ('download-sync', 'download-source', 'manual:download-sync', 'pending', ?,
        'convergence', 'user', 'download-complete', ?, ?)
    `).run(now, now, now)

    expect(getRun('download-complete')).toMatchObject({
      awaitingSourceSync: true,
      sourceRequestStatus: 'pending',
    })
    expect(listRuns().items[0]).toMatchObject({
      id: 'download-complete',
      awaitingSourceSync: true,
      sourceRequestStatus: 'pending',
    })

    getDb().prepare("UPDATE source_sync_queue SET status = 'running' WHERE id = 'download-sync'").run()
    expect(getRun('download-complete')?.sourceRequestStatus).toBe('running')
    getDb().prepare("UPDATE playlist_sources SET requires_match_reconcile = 0 WHERE id = 'download-source'").run()
    getDb().prepare("UPDATE source_sync_queue SET status = 'completed' WHERE id = 'download-sync'").run()
    expect(getRun('download-complete')).toMatchObject({
      awaitingSourceSync: false,
      sourceRequestStatus: null,
    })
    expect(listRuns().items[0]).toMatchObject({
      awaitingSourceSync: false,
      sourceRequestStatus: null,
    })
  })

  it('projects source request status from the current run instead of a same-source historical run', () => {
    setup()
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('shared-source', 2002, '共享来源', ?, ?)
    `).run(now, now)
    const run = (id: string, status: TaskRun['status']): TaskRun => ({
      id,
      type: 'sync',
      trigger: 'user',
      startedAt: now,
      finishedAt: status === 'running' ? null : now,
      status,
      durationMs: 0,
      summary: id,
      source: '共享来源',
      sourceIds: ['shared-source'],
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
    saveRun(run('historical-run', 'success'))
    saveRun(run('new-run', 'running'))
    getDb().prepare(`
      INSERT INTO source_sync_queue (
        id, source_id, schedule_window, status, available_at, request_kind,
        trigger, run_id, created_at, updated_at
      ) VALUES
        ('historical-request', 'shared-source', 'history', 'completed', ?, 'convergence', 'user', 'historical-run', ?, ?),
        ('new-request', 'shared-source', 'new', 'pending', ?, 'convergence', 'user', 'new-run', ?, ?)
    `).run(now, now, now, now, now, now)

    expect(getRun('historical-run')?.sourceRequestStatus).toBeNull()
    expect(getRun('new-run')?.sourceRequestStatus).toBe('pending')
    expect(listRuns().items.find(item => item.id === 'historical-run')?.sourceRequestStatus).toBeNull()
    expect(listRuns().items.find(item => item.id === 'new-run')?.sourceRequestStatus).toBe('pending')
  })
})
