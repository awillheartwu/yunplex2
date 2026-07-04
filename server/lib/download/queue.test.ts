import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { TagWriteError } from '../tag-writer'
import { clearQueuedDownloadTasks, enqueueTask, processAll, retryTask } from './queue'

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

  it('clears waiting and failed tasks without deleting running or historical records', () => {
    setupDb()
    insertTask('task-1', 'pending')
    insertTask('task-2', 'failed')
    insertTask('task-3', 'downloading')
    insertTask('task-4', 'tagging')
    insertTask('task-5', 'done')

    expect(clearQueuedDownloadTasks()).toBe(2)

    const remaining = getDb()
      .prepare('SELECT id, status FROM download_tasks ORDER BY id')
      .all() as Array<{ id: string; status: string }>

    expect(remaining).toEqual([
      { id: 'task-3', status: 'downloading' },
      { id: 'task-4', status: 'tagging' },
      { id: 'task-5', status: 'done' },
    ])
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
})
