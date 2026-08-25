import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../db'
import { appendLog, readLogs } from './store'

const directories: string[] = []

function setup(): void {
  const directory = mkdtempSync(join(tmpdir(), 'reyunplex-logs-'))
  directories.push(directory)
  initDb(directory)
}

describe('diagnostic log store', () => {
  afterEach(() => {
    closeDb()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('stores diagnostic entries and exposes error detail', () => {
    setup()
    appendLog({ level: 'warn', message: 'Plex 暂时不可用', stage: 'plex_match' })
    appendLog({ level: 'error', message: '标签写入失败', detail: 'EIO', stage: 'tags' })

    expect(readLogs({ level: 'error' })).toMatchObject({
      total: 1,
      items: [{ level: 'error', message: '标签写入失败', detail: 'EIO', stage: 'tags' }],
    })
    expect(readLogs().total).toBe(2)

  })
})
