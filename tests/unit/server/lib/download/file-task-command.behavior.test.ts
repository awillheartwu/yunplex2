import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createManualDownloadRun } from '~~/server/lib/run/store'
import { enqueueTask, getDownloadTask } from '~~/server/lib/download/queue'
import { submitFileTasks } from '~~/server/lib/download/file-task-command'
import { createDownloadWorker } from '~~/server/lib/download/worker'
import { getMediaCorrection, prepareMediaCorrection } from '~~/server/lib/sync/media-corrections'

let directory = ''

afterEach(() => {
  closeDb()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = ''
})

describe('file task submission cancellation behavior', () => {
  it('retains the correction identity when persisting distinct execution options', async () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-file-correction-'))
    initDb(directory)
    createManualDownloadRun({ id: 'correction', total: 1, sourceLabel: 'Correction' })
    const id = prepareMediaCorrection(101, null)
    const handle = submitFileTasks([{ songId: 101, songName: 'Song', artist: 'Artist', album: 'Album', jobId: 'correction',
      idempotencyKey: `song:101:correction:${id}`, executionIntent: { downloadMode: 'full', embedMetadata: true } }])
    const path = join(directory, 'correction.flac')
    writeFileSync(path, 'fLaC')
    const worker = createDownloadWorker({ getConcurrency: () => 1, execute: async () => ({ filePath: path, fileType: 'flac', ops: { download: 'ok' } }) })
    await worker.wake()
    expect(handle.readResults()[0]?.status).toBe('done')
    expect(getMediaCorrection(101)?.status).toBe('ready')
    await worker.stop()
  })

  it('keeps different options as separate ordered writes while reusing identical requests', async () => {
    directory = mkdtempSync(join(tmpdir(), 'reyunplex-file-options-'))
    initDb(directory)
    for (const id of ['first', 'second', 'same']) createManualDownloadRun({ id, total: 1, sourceLabel: id })
    const intent = (jobId: string, enabled: boolean) => ({
      songId: 101, songName: 'Song', artist: 'Artist', album: 'Album', jobId, idempotencyKey: 'song-101',
      executionIntent: { downloadLyrics: enabled, embedMetadata: enabled, embedCover: enabled },
    })
    const first = submitFileTasks([intent('first', false)]), second = submitFileTasks([intent('second', true)])
    const same = submitFileTasks([intent('same', true)])
    expect(first.taskIds).not.toEqual(second.taskIds)
    expect(same.taskIds).toEqual(second.taskIds)
    let began!: () => void, finish!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const release = new Promise<void>(resolve => { finish = resolve })
    const choices: boolean[] = []
    const worker = createDownloadWorker({ getConcurrency: () => 3, execute: async task => {
      choices.push(task.executionIntent!.downloadLyrics!)
      if (task.id === first.taskIds[0]) { began(); await release }
      return { filePath: '/fixture/song.flac', fileType: 'flac' }
    } })
    const draining = worker.wake()
    await started
    expect(choices).toEqual([false])
    finish()
    await draining
    expect(choices).toEqual([false, true])
    expect(second.readResults()[0]).toMatchObject({ status: 'done', executionIntent: { downloadLyrics: true, embedMetadata: true, embedCover: true } })
    await worker.stop()
  })

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
