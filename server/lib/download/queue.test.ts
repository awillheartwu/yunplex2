import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { TagWriteError } from '../tag-writer'
import { getLocalMediaAsset, upsertLocalMediaAsset } from '../sync/local-media-store'
import {
  enqueueTask,
  getDownloadTask,
  listDownloadTasks,
  processAll,
  recoverExpiredDownloadTasks,
  retryTask,
} from './queue'

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

  it('retries only the requested task even when other failed tasks share the same run', async () => {
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

    await retryTask(first.id, async (task) => ({
      filePath: `/tmp/music/${task.songId}.flac`,
      fileType: 'flac',
    }))

    const rows = getDb()
      .prepare('SELECT id, status FROM download_tasks ORDER BY song_id')
      .all() as Array<{ id: string; status: string }>

    expect(rows).toEqual([
      { id: first.id, status: 'done' },
      { id: second.id, status: 'failed' },
    ])
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
