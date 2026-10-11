import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createManualDownloadRun } from '~~/server/lib/run/store'
import { enqueueTask, getDownloadTask } from '~~/server/lib/download/queue'
import { submitFileTasks } from '~~/server/lib/download/file-task-command'

let directory = ''

afterEach(() => {
  closeDb()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('file task submission cancellation behavior', () => {
  it('only stops waiting and leaves shared queue tasks pending', async () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-file-task-command-'))
    initDb(directory)
    createManualDownloadRun({ id: 'repair-run', total: 1, sourceLabel: 'Repair caller' })
    const handle = submitFileTasks([{
      sourceId: 'source-one',
      songId: 101,
      songName: 'Repair song',
      artist: 'Artist',
      album: 'Album',
      jobId: 'repair-run',
      idempotencyKey: 'repair-task',
    }])
    const unrelated = enqueueTask({
      sourceId: 'source-two',
      songId: 202,
      songName: 'Unrelated song',
      artist: 'Artist',
      album: 'Album',
      idempotencyKey: 'unrelated-task',
    })
    const cancel = () => { throw new Error('cancelled') }

    await expect(handle.wait({ throwIfCancelled: cancel })).rejects.toThrow('cancelled')

    expect(getDownloadTask(handle.taskIds[0]!)).toMatchObject({ status: 'pending' })
    expect(getDownloadTask(unrelated.id)).toMatchObject({ status: 'pending' })
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM download_tasks WHERE status = 'pending'").get())
      .toEqual({ count: 2 })
  })
})
