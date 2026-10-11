import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createFileTaskSchema, linkRunFileTask } from '~~/server/lib/db/file-task-schema'
import { TagWriteError } from '~~/server/lib/tag-writer'
import { createManualDownloadRun, getRun } from '~~/server/lib/run/store'
import { getLocalMediaAsset, upsertLocalMediaAsset } from '~~/server/lib/sync/local-media-store'
import {
  enqueueTask,
  getDownloadTask,
  listDownloadTasks,
  processAll,
  recoverExpiredDownloadTasks,
  requeueFailedDownloadTasks,
} from '~~/server/lib/download/queue'

const tempDirs: string[] = []

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-download-queue-'))
  tempDirs.push(dir)
  initDb(dir)
}

function insertTask(id: string, status: 'pending' | 'downloading' | 'tagging' | 'done' | 'failed') {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO download_tasks (
      id, source_id, song_id, song_name, status, created_at, updated_at
    )
    VALUES (?, NULL, ?, ?, ?, ?, ?)
  `).run(id, Number(id.replace(/\D/g, '')) || 1, id, status, now, now)
}

describe('download queue cleanup', () => {
  afterEach(() => {
    closeDb()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reuses an active task with the same idempotency key', () => {
    setupDb()

    const first = enqueueTask({
      sourceId: 'source-a',
      songId: 1,
      songName: 'Song',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      idempotencyKey: 'same-file',
    })
    const second = enqueueTask({
      sourceId: null,
      songId: 1,
      songName: 'Song',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      idempotencyKey: 'same-file',
    })

    expect(second.id).toBe(first.id)
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM download_tasks').get() as { count: number }).count).toBe(1)
  })

  it('persists the operation and target required to resume a media task', () => {
    setupDb()

    const task = enqueueTask({
      sourceId: 'source-a',
      songId: 99,
      songName: 'Repair',
      artist: 'Artist',
      album: 'Album',
      operation: 'repair_existing',
      targetPath: '/music/repair.flac',
      executionIntent: {
        downloadMode: 'missing',
        target: { kind: 'existing', path: '/music/repair.flac' },
        downloadLyrics: true,
        embedMetadata: true,
        embedCover: false,
      },
      idempotencyKey: 'repair-file',
    })

    expect(task).toMatchObject({
      operation: 'repair_existing',
      targetPath: '/music/repair.flac',
      executionIntent: {
        downloadMode: 'missing',
        target: { kind: 'existing', path: '/music/repair.flac' },
        downloadLyrics: true,
        embedMetadata: true,
        embedCover: false,
      },
    })
  })

  it('returns stable active queue order and the playlist source name', () => {
    setupDb()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-a', 1001, '强制重下载歌单', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z')
    `).run()
    const insert = getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, status, progress, created_at, updated_at
      ) VALUES (?, 'source-a', ?, ?, ?, ?, ?, ?)
    `)
    insert.run('pending-newer', 1, '等待歌曲', 'pending', 0, '2026-07-24T00:02:00.000Z', '2026-07-24T00:02:00.000Z')
    insert.run('running-older', 2, '下载歌曲', 'downloading', 42, '2026-07-24T00:01:00.000Z', '2026-07-24T00:03:00.000Z')
    insert.run('tagging-newer', 3, '标签歌曲', 'tagging', 91, '2026-07-24T00:03:00.000Z', '2026-07-24T00:04:00.000Z')

    const result = listDownloadTasks({ status: 'pending,downloading,tagging' })

    expect(result.items.map(item => item.id)).toEqual(['running-older', 'tagging-newer', 'pending-newer'])
    expect(result.items.every(item => item.sourceName === '强制重下载歌单')).toBe(true)
  })

  it('projects done tasks awaiting source sync from the task source at read time', () => {
    setupDb()
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (
        id, netease_playlist_id, name, requires_match_reconcile, created_at, updated_at
      ) VALUES
        ('task-source', 1002, '任务来源', 1, ?, ?),
        ('owner-source', 1003, '历史 owner 来源', 0, ?, ?)
    `).run(now, now, now, now)
    const task = enqueueTask({
      sourceId: 'owner-source',
      songId: 101,
      songName: '重试后的歌曲',
      artist: 'Artist',
      album: 'Album',
      jobId: 'historical-sync-owner',
      idempotencyKey: 'task-source-awaiting-sync',
    })
    createManualDownloadRun({
      id: 'current-caller',
      total: 1,
      sourceLabel: '当前调用者',
      sourceIds: ['task-source'],
    })
    createFileTaskSchema(getDb())
    linkRunFileTask(getDb(), {
      runId: 'current-caller',
      taskId: task.id,
      sourceId: 'task-source',
    })
    getDb().prepare("UPDATE download_tasks SET status = 'done' WHERE id = ?").run(task.id)

    expect(getDownloadTask(task.id)).toMatchObject({
      status: 'done',
      jobId: 'historical-sync-owner',
      awaitingSourceSync: true,
    })
    expect(listDownloadTasks({ status: 'done' }).items).toEqual([
      expect.objectContaining({ id: task.id, awaitingSourceSync: true }),
    ])

    createManualDownloadRun({ id: 'historical-sync-owner', total: 1, sourceLabel: 'Owner' })
    getDb().prepare("UPDATE task_runs SET type='sync',status='running' WHERE id='historical-sync-owner'").run()
    expect(getDownloadTask(task.id)?.awaitingSourceSync).toBe(false)
    getDb().prepare("UPDATE task_runs SET status='cancelled' WHERE id='historical-sync-owner'").run()
    expect(getDownloadTask(task.id)?.awaitingSourceSync).toBe(true)

    getDb().prepare("UPDATE playlist_sources SET requires_match_reconcile = 0 WHERE id IN ('task-source', 'owner-source')").run()
    expect(getDownloadTask(task.id)?.awaitingSourceSync).toBe(false)
    expect(listDownloadTasks({ status: 'done' }).items[0]?.awaitingSourceSync).toBe(false)

    getDb().prepare("UPDATE playlist_sources SET requires_match_reconcile = 1 WHERE id = 'task-source'").run()
    getDb().prepare("UPDATE download_tasks SET status = 'downloading' WHERE id = ?").run(task.id)
    expect(getDownloadTask(task.id)?.awaitingSourceSync).toBe(false)
  })

  it('filters tasks by run id so task center can follow one live run including downstream-ready songs', () => {
    setupDb()
    const insert = getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, status, progress, run_id, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run('run-a-downloading', 1, 'Run A Downloading', 'downloading', 42, 'run-a', '2026-07-25T10:00:00.000Z', '2026-07-25T10:00:00.000Z')
    insert.run('run-a-done', 2, 'Run A Done', 'done', 100, 'run-a', '2026-07-25T10:01:00.000Z', '2026-07-25T10:03:00.000Z')
    insert.run('run-b-downloading', 3, 'Run B Downloading', 'downloading', 15, 'run-b', '2026-07-25T10:02:00.000Z', '2026-07-25T10:02:00.000Z')

    const result = listDownloadTasks({ status: 'pending,downloading,tagging,done', runId: 'run-a' })

    expect(result.items.map(item => item.id)).toEqual(['run-a-downloading', 'run-a-done'])
  })

  it('records tag write failures with file path and file type', async () => {
    setupDb()
    const task = enqueueTask({
      songId: 2,
      songName: 'Tagged',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      idempotencyKey: 'tagged-file',
    })

    await processAll(async () => {
      throw new TagWriteError({
        filePath: '/tmp/music/tagged.flac',
        fileType: 'flac',
        ops: { download: 'ok', lyric: 'skipped', tags: 'failed', cover: 'failed' },
        detail: 'EIO',
      })
    }, undefined, 1, [task.id])

    const row = getDb().prepare('SELECT status, error, file_path, file_type FROM download_tasks WHERE id = ?').get(task.id) as {
      status: string
      error: string
      file_path: string
      file_type: string
    }
    expect(row).toEqual({
      status: 'failed',
      error: '标签写入失败: EIO',
      file_path: '/tmp/music/tagged.flac',
      file_type: 'flac',
    })
  })

  it('writes manual terminal failures but leaves source failures to Source Convergence', async () => {
    setupDb()
    const manualTask = enqueueTask({
      songId: 20,
      songName: 'Manual',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
    })
    const sourceTask = enqueueTask({
      sourceId: 'source-one',
      songId: 21,
      songName: 'Source',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
    })

    await processAll(async () => { throw new Error('network') }, undefined, 1, [manualTask.id])
    await processAll(async () => { throw new Error('network') }, undefined, 1, [sourceTask.id])

    expect(getDb().prepare(`
      SELECT song_id, source_id, failure_kind
      FROM failure_records
    `).all()).toEqual([{
      song_id: 20,
      source_id: null,
      failure_kind: 'failed_download',
    }])
  })

  it('attributes a source-aware manual download failure to its Playlist Source', async () => {
    setupDb()
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
      VALUES ('source-manual', 1001, '来源托管下载', ?, ?)
    `).run(now, now)
    createManualDownloadRun({
      id: 'managed-run',
      total: 1,
      sourceLabel: '来源托管下载 · 下载并托管',
      sourceIds: ['source-manual'],
    })
    const task = enqueueTask({
      sourceId: 'source-manual',
      songId: 22,
      songName: 'Managed from source',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      jobId: 'managed-run',
    })

    await processAll(async () => { throw new Error('network') }, 'managed-run', 1, [task.id])

    expect(getDb().prepare(`
      SELECT song_id, source_id, source_name, run_type
      FROM failure_records
    `).get()).toEqual({
      song_id: 22,
      source_id: 'source-manual',
      source_name: '来源托管下载',
      run_type: 'manual_download',
    })
    expect(getRun('managed-run')?.songs[0]?.sourceId).toBe('source-manual')
  })

  it('records audio bytes written by YunPlex as a managed local media asset', async () => {
    setupDb()
    const task = enqueueTask({
      songId: 3,
      songName: 'Managed',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
    })
    const filePath = join(tempDirs.at(-1)!, 'managed.flac')
    writeFileSync(filePath, 'audio')

    await processAll(async () => ({
      filePath,
      fileType: 'flac',
      ops: { download: 'ok', lyric: 'skipped', tags: 'ok', cover: 'skipped' },
    }), undefined, 1, [task.id])

    expect(getLocalMediaAsset(task.songId)).toMatchObject({
      filePath,
      ownership: 'managed',
      evidence: expect.objectContaining({ audioOperation: 'downloaded' }),
    })
  })

  it('records a pre-existing audio file reused by a task as external media', async () => {
    setupDb()
    const task = enqueueTask({
      songId: 4,
      songName: 'Adopted',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
    })
    const filePath = join(tempDirs.at(-1)!, 'adopted.flac')
    writeFileSync(filePath, 'audio')

    await processAll(async () => ({
      filePath,
      fileType: 'flac',
      ops: { download: 'skipped', lyric: 'ok', tags: 'ok', cover: 'skipped' },
    }), undefined, 1, [task.id])

    expect(getLocalMediaAsset(task.songId)).toMatchObject({
      ownership: 'external',
      evidence: expect.objectContaining({ audioOperation: 'adopted_existing' }),
    })
  })

  it('keeps an already managed asset managed when a repair task reuses its audio', async () => {
    setupDb()
    const task = enqueueTask({
      songId: 5,
      songName: 'Repaired',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
    })
    const filePath = join(tempDirs.at(-1)!, 'repaired.flac')
    writeFileSync(filePath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: task.songId,
      filePath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })

    await processAll(async () => ({
      filePath,
      fileType: 'flac',
      ops: { download: 'skipped', lyric: 'ok', tags: 'ok', cover: 'skipped' },
    }), undefined, 1, [task.id])

    expect(getLocalMediaAsset(task.songId)).toMatchObject({
      ownership: 'managed',
      evidence: expect.objectContaining({
        audioOperation: 'reused_managed',
      }),
    })
  })

  it('requeues only the requested failed task without executing it in the caller', async () => {
    setupDb()
    const first = enqueueTask({
      songId: 10,
      songName: 'First',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      jobId: 'run-1',
      idempotencyKey: 'first-file',
    })
    const second = enqueueTask({
      songId: 11,
      songName: 'Second',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      jobId: 'run-1',
      idempotencyKey: 'second-file',
    })
    getDb().prepare("UPDATE download_tasks SET status = 'failed' WHERE id IN (?, ?)").run(first.id, second.id)

    const retried = requeueFailedDownloadTasks([first.id])

    const rows = getDb()
      .prepare('SELECT id, status FROM download_tasks ORDER BY song_id')
      .all() as Array<{ id: string; status: string }>

    expect(rows).toEqual([
      { id: first.id, status: 'pending' },
      { id: second.id, status: 'failed' },
    ])
    expect(retried).toHaveLength(1)
    expect(retried[0]).toMatchObject({ id: first.id, status: 'pending', retryCount: 1 })
  })

  it('does not claim a failed task when another active task owns the same idempotency key', async () => {
    setupDb()
    const active = enqueueTask({
      songId: 12,
      songName: 'Active',
      artist: 'Artist',
      album: 'Album',
      quality: 'lossless',
      idempotencyKey: 'shared-file',
    })
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress, quality, idempotency_key, created_at, updated_at
      )
      VALUES (?, NULL, ?, ?, ?, ?, 'failed', 0, ?, ?, ?, ?)
    `).run('failed-same-key', 13, 'Failed', 'Artist', 'Album', 'lossless', 'shared-file', now, now)

    let processed = 0
    await processAll(async () => {
      processed++
      return { filePath: '/tmp/music/failed.flac', fileType: 'flac' }
    }, undefined, 1, ['failed-same-key'])

    const rows = getDb()
      .prepare('SELECT id, status FROM download_tasks ORDER BY song_id')
      .all() as Array<{ id: string; status: string }>

    expect(processed).toBe(0)
    expect(rows).toEqual([
      { id: active.id, status: 'pending' },
      { id: 'failed-same-key', status: 'failed' },
    ])
  })

  it('releases a worker slot when a task stops making progress', async () => {
    setupDb()
    const stalled = enqueueTask({
      songId: 20,
      songName: 'Stalled on NAS',
      artist: 'Artist',
      album: 'Album',
      idempotencyKey: 'stalled-file',
    })
    const next = enqueueTask({
      songId: 21,
      songName: 'Next in queue',
      artist: 'Artist',
      album: 'Album',
      idempotencyKey: 'next-file',
    })

    await processAll(async (task, onProgress) => {
      if (task.id === stalled.id) {
        onProgress(100, 'tagging')
        await new Promise(() => undefined)
      }
      return { filePath: `/tmp/music/${task.songId}.flac`, fileType: 'flac' }
    }, undefined, 1, [stalled.id, next.id], {
      inactivityTimeoutMs: 20,
    })

    expect(getDownloadTask(stalled.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('无进展超时'),
    })
    expect(getDownloadTask(next.id)).toMatchObject({
      status: 'done',
    })
  })

  it('recovers only active tasks whose lease expired', () => {
    setupDb()
    insertTask('expired-task', 'tagging')
    insertTask('healthy-task', 'downloading')
    getDb().prepare(`
      UPDATE download_tasks
      SET lease_owner = 'worker-a', lease_expires_at = ?
      WHERE id = 'expired-task'
    `).run('2026-07-24T10:00:00.000Z')
    getDb().prepare(`
      UPDATE download_tasks
      SET lease_owner = 'worker-b', lease_expires_at = ?
      WHERE id = 'healthy-task'
    `).run('2026-07-24T12:00:00.000Z')

    expect(recoverExpiredDownloadTasks('2026-07-24T11:00:00.000Z')).toBe(1)
    expect(getDownloadTask('expired-task')).toMatchObject({
      status: 'failed',
      progress: 0,
      error: expect.stringContaining('租约过期'),
    })
    expect(getDownloadTask('healthy-task')).toMatchObject({
      status: 'downloading',
    })
  })

  it('does not let a timed-out processor overwrite the failed state when it returns late', async () => {
    setupDb()
    const task = enqueueTask({
      songId: 22,
      songName: 'Late NAS result',
      artist: 'Artist',
      album: 'Album',
      idempotencyKey: 'late-file',
    })
    let releaseProcessor!: () => void
    const processorGate = new Promise<void>((resolve) => {
      releaseProcessor = resolve
    })

    await processAll(async (_task, onProgress) => {
      onProgress(100, 'tagging')
      await processorGate
      return { filePath: '/tmp/music/late.flac', fileType: 'flac' }
    }, undefined, 1, [task.id], {
      inactivityTimeoutMs: 20,
    })

    releaseProcessor()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(getDownloadTask(task.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('无进展超时'),
    })
  })
})
