import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { createManualDownloadRun, createRepairRun, getRun, recoverInterruptedRuns, syncManualDownloadRun, syncRepairRun } from '../run/store'
import { submitFileTasks } from './file-task-command'
import { getDownloadTask, listDownloadTasks, processAll } from './queue'

let directory = ''

function setupDb() {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-file-task-association-'))
  initDb(directory)
  createFileTaskSchema(getDb())
  const now = new Date().toISOString()
  const insertSource = getDb().prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  insertSource.run('source-owner', 1001, 'Owner source', now, now)
  insertSource.run('source-caller', 1002, 'Caller source', now, now)
}

afterEach(() => {
  closeDb()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

function intent(jobId: string, sourceId: string, operation: 'download' | 'repair_existing' = 'download') {
  return {
    sourceId,
    songId: 401,
    songName: operation === 'repair_existing' ? 'Repair song' : 'Shared song',
    artist: 'Artist',
    album: 'Album',
    quality: 'lossless',
    jobId,
    operation,
    targetPath: operation === 'repair_existing' ? join(directory, 'repair.flac') : undefined,
    idempotencyKey: `shared-${operation}`,
  }
}

describe('persistent file task caller associations', () => {
  it('projects a deduped task into both callers and preserves both source contexts', async () => {
    setupDb()
    createManualDownloadRun({ id: 'owner-run', total: 1, sourceLabel: 'Owner', sourceIds: ['source-owner'] })
    const owner = submitFileTasks([intent('owner-run', 'source-owner')]).tasks[0]!
    createManualDownloadRun({ id: 'caller-run', total: 1, sourceLabel: 'Caller', sourceIds: ['source-caller'] })
    const callerHandle = submitFileTasks([intent('caller-run', 'source-caller')])
    const caller = callerHandle.tasks[0]!

    expect(caller.task.id).toBe(owner.task.id)
    expect(caller.reused).toBe(true)
    expect(listDownloadTasks({ runId: 'caller-run' }).items.map(task => task.id)).toEqual([owner.task.id])
    await expect(callerHandle.wait({ throwIfCancelled: () => { throw new Error('cancelled') } }))
      .rejects.toThrow('cancelled')
    expect(getDownloadTask(owner.task.id)).toMatchObject({ status: 'pending' })
    expect(getDownloadTask(owner.task.id)).toMatchObject({ jobId: 'owner-run', sourceId: 'source-owner' })
    expect(getDb().prepare(`
      SELECT run_id, task_id, source_id
      FROM run_file_tasks
      ORDER BY run_id
    `).all()).toEqual([
      { run_id: 'caller-run', task_id: owner.task.id, source_id: 'source-caller' },
      { run_id: 'owner-run', task_id: owner.task.id, source_id: 'source-owner' },
    ])

    const filePath = join(directory, 'shared.flac')
    writeFileSync(filePath, 'audio')
    await processAll(async () => ({
      filePath,
      fileType: 'flac',
      ops: { download: 'ok', tags: 'ok' },
    }), undefined, 1, [owner.task.id])

    expect(getRun('owner-run')).toMatchObject({ status: 'success', successSongs: 1 })
    expect(getRun('caller-run')).toMatchObject({ status: 'success', successSongs: 1 })
    expect(getRun('caller-run')?.songs[0]).toMatchObject({ sourceId: 'source-caller', status: 'success' })
    expect(getDb().prepare(`SELECT id, requires_match_reconcile FROM playlist_sources ORDER BY id`).all())
      .toEqual([
        { id: 'source-caller', requires_match_reconcile: 1 },
        { id: 'source-owner', requires_match_reconcile: 1 },
      ])
  })

  it('recovers a repair caller from the persisted association after restart', () => {
    setupDb()
    createRepairRun({ id: 'repair-owner', total: 1, skipped: 0, sourceId: 'source-owner', sourceLabel: 'Owner' })
    const owner = submitFileTasks([intent('repair-owner', 'source-owner', 'repair_existing')]).tasks[0]!
    createRepairRun({ id: 'repair-caller', total: 1, skipped: 0, sourceId: 'source-caller', sourceLabel: 'Caller' })
    const caller = submitFileTasks([intent('repair-caller', 'source-caller', 'repair_existing')]).tasks[0]!
    expect(caller.task.id).toBe(owner.task.id)
    expect(caller.reused).toBe(true)

    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE download_tasks
      SET status = 'done', progress = 100, updated_at = ?
      WHERE id = ?
    `).run(now, owner.task.id)

    closeDb()
    initDb(directory)
    expect(recoverInterruptedRuns()).toBe(0)
    expect(getRun('repair-caller')).toMatchObject({ status: 'running' })
    expect(syncRepairRun('repair-caller')).toMatchObject({ status: 'success', successSongs: 1 })
  })

  it('keeps a source-less manual caller source-less when reusing a source-owned task', () => {
    setupDb()
    createManualDownloadRun({ id: 'sourceful-owner', total: 1, sourceLabel: 'Owner', sourceIds: ['source-owner'] })
    const owner = submitFileTasks([intent('sourceful-owner', 'source-owner')]).tasks[0]!
    createManualDownloadRun({ id: 'source-less-caller', total: 1, sourceLabel: 'Manual caller' })
    const caller = submitFileTasks([{
      ...intent('source-less-caller', 'source-owner'),
      sourceId: null,
    }]).tasks[0]!

    expect(caller.task.id).toBe(owner.task.id)
    expect(caller.reused).toBe(true)
    expect(syncManualDownloadRun('source-less-caller')?.songs[0]?.sourceId).toBeUndefined()
    expect(getRun('source-less-caller')?.sourceIds).toEqual([])
  })

  it('does not mark associated sources pending on a failed task', async () => {
    setupDb()
    createManualDownloadRun({ id: 'failed-caller', total: 1, sourceLabel: 'Caller', sourceIds: ['source-caller'] })
    const handle = submitFileTasks([intent('failed-caller', 'source-caller')])

    await processAll(async () => { throw new Error('network') }, undefined, 1, [...handle.taskIds])

    expect(getDb().prepare(`
      SELECT id, requires_match_reconcile
      FROM playlist_sources
      WHERE id = 'source-caller'
    `).get()).toEqual({ id: 'source-caller', requires_match_reconcile: 0 })
  })

  it('cascades associations when either retained owner is deleted', () => {
    setupDb()
    createManualDownloadRun({ id: 'lifecycle-run', total: 1, sourceLabel: 'Lifecycle' })
    submitFileTasks([intent('lifecycle-run', 'source-owner')])
    const foreignKeys = getDb().pragma('foreign_key_list(run_file_tasks)') as Array<{
      table: string
      from: string
      on_delete: string
    }>
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'task_runs', from: 'run_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ table: 'download_tasks', from: 'task_id', on_delete: 'CASCADE' }),
    ]))

    getDb().prepare('DELETE FROM task_runs WHERE id = ?').run('lifecycle-run')
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM run_file_tasks').get()).toEqual({ count: 0 })

    createManualDownloadRun({ id: 'lifecycle-run-2', total: 1, sourceLabel: 'Lifecycle' })
    const second = submitFileTasks([intent('lifecycle-run-2', 'source-owner')])
    getDb().prepare('DELETE FROM download_tasks WHERE id = ?').run(second.taskIds[0])
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM run_file_tasks').get()).toEqual({ count: 0 })
  })

  it('upgrades a legacy association table while dropping orphaned links', () => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    legacy.exec(`
      CREATE TABLE task_runs (id TEXT PRIMARY KEY);
      CREATE TABLE download_tasks (id TEXT PRIMARY KEY);
      CREATE TABLE run_file_tasks (
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id)
      );
      CREATE INDEX idx_run_file_tasks_task ON run_file_tasks(task_id, run_id);
      CREATE INDEX idx_run_file_tasks_source ON run_file_tasks(source_id, run_id);
      INSERT INTO task_runs VALUES ('run-1');
      INSERT INTO download_tasks VALUES ('task-1');
      INSERT INTO run_file_tasks VALUES ('run-1', 'task-1', 'source-1', 'now');
      INSERT INTO run_file_tasks VALUES ('orphan-run', 'orphan-task', NULL, 'now');
    `)

    createFileTaskSchema(legacy)
    expect(legacy.prepare('SELECT COUNT(*) AS count FROM run_file_tasks').get()).toEqual({ count: 1 })
    expect(legacy.pragma('foreign_key_list(run_file_tasks)')).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'task_runs', from: 'run_id', on_delete: 'CASCADE' }),
      expect.objectContaining({ table: 'download_tasks', from: 'task_id', on_delete: 'CASCADE' }),
    ]))
    legacy.prepare('DELETE FROM task_runs WHERE id = ?').run('run-1')
    expect(legacy.prepare('SELECT COUNT(*) AS count FROM run_file_tasks').get()).toEqual({ count: 0 })
    legacy.close()
  })

  it('does not cache schema capability before an outer transaction commits', () => {
    const transactional = new Database(':memory:')
    transactional.pragma('foreign_keys = ON')
    transactional.exec(`
      CREATE TABLE task_runs (id TEXT PRIMARY KEY);
      CREATE TABLE download_tasks (id TEXT PRIMARY KEY);
    `)
    expect(() => transactional.transaction(() => {
      createFileTaskSchema(transactional)
      throw new Error('rollback schema')
    })()).toThrow('rollback schema')
    expect(transactional.prepare("SELECT name FROM sqlite_master WHERE name = 'run_file_tasks'").get()).toBeUndefined()

    createFileTaskSchema(transactional)
    expect(transactional.prepare("SELECT name FROM sqlite_master WHERE name = 'run_file_tasks'").get())
      .toEqual({ name: 'run_file_tasks' })
    transactional.close()
  })
})
