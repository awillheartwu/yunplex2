import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import {
  createManualDownloadRun,
  getRun,
  listRuns,
  saveRun,
  syncManualDownloadRun,
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
  })

  it('migrates old legacy jobs into task_runs and drops the legacy table', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reyunplex-legacy-runs-'))
    directories.push(directory)
    const db = new Database(join(directory, 'data.db'))
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        total_songs INTEGER NOT NULL DEFAULT 0,
        success_songs INTEGER NOT NULL DEFAULT 0,
        failed_songs INTEGER NOT NULL DEFAULT 0,
        skipped_songs INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        dry_run INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '网易云音乐',
        target TEXT NOT NULL DEFAULT 'Plex',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO jobs (
        id, started_at, finished_at, status, summary, total_songs,
        success_songs, failed_songs, skipped_songs,
        warnings, dry_run, source, target, duration_ms, data
      ) VALUES (
        'legacy-run', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:01.000Z',
        'success', '旧同步完成', 1, 1, 0, 0, 0, 0, '网易云音乐', 'Plex', 1000,
        '{"id":"legacy-run","type":"sync","trigger":"system","startedAt":"2026-06-22T00:00:00.000Z","finishedAt":"2026-06-22T00:00:01.000Z","status":"success","durationMs":1000,"summary":"旧同步完成","source":"网易云音乐","sourceIds":["source-legacy"],"target":"Plex","totalSongs":1,"successSongs":1,"failedSongs":0,"skippedSongs":0,"removedSongs":0,"warnings":0,"dryRun":false,"steps":[],"songs":[],"config":{}}'
      );
      PRAGMA user_version = 30;
    `)
    db.close()

    initDb(directory)

    const legacyTable = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get()
    expect(legacyTable).toBeUndefined()
    expect(getRun('legacy-run')).toMatchObject({
      id: 'legacy-run',
      type: 'sync',
      summary: '旧同步完成',
      sourceIds: ['source-legacy'],
    })
    expect(listRuns({ sourceId: 'source-legacy' }).items.map(run => run.id)).toEqual(['legacy-run'])
  })

  it('persists and completes a manual download run from its task results', () => {
    setup()
    createManualDownloadRun({ id: 'batch-1', total: 2, sourceLabel: '两首单曲' })
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        job_id, run_id, created_at, updated_at
      ) VALUES
        ('one', NULL, 1, 'One', 'A', 'X', 'done', 100, 'batch-1', 'batch-1', ?, ?),
        ('two', NULL, 2, 'Two', 'B', 'Y', 'failed', 0, 'batch-1', 'batch-1', ?, ?)
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
