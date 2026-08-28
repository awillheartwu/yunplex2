import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import {
  createManualDownloadRun,
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

  it('marks interrupted active download tasks as failed during recovery', () => {
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

    const rows = getDb().prepare('SELECT id, status, error FROM download_tasks ORDER BY id').all() as Array<{
      id: string
      status: string
      error: string
    }>
    expect(rows).toEqual([
      { id: 'downloading-one', status: 'failed', error: '任务因服务重启中断' },
      { id: 'tagging-two', status: 'failed', error: '任务因服务重启中断' },
    ])
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count).toBe(2)
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
      SELECT source_id, run_type FROM failure_records WHERE song_id = 31
    `).get()).toEqual({ source_id: 'source-one', run_type: 'manual_download' })
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
})
