import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, initDb } from '../db'
import { clearQueuedDownloadTasks } from './queue'

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
})
