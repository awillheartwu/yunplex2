import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { appendLog, readLogs } from '~~/server/lib/log/store'

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
      items: [{
        level: 'error',
        message: '标签写入失败',
        detail: 'EIO',
        stage: 'tags',
        errorCode: 'failed_tags',
        errorCategory: 'media',
        retryable: true,
      }],
    })
    expect(readLogs().total).toBe(2)

  })

  it('redacts both log fields before storage and sanitizes existing rows on read', () => {
    setup()
    const entry = appendLog({
      level: 'info',
      message: 'Plex 请求 token=fixture-token',
      detail: 'Authorization: Bearer fixture-bearer',
    })
    const stored = getDb().prepare('SELECT message, detail FROM logs WHERE id = ?').get(entry.id)
    for (const value of [entry, stored]) {
      expect(JSON.stringify(value)).not.toContain('fixture-token')
      expect(JSON.stringify(value)).not.toContain('fixture-bearer')
    }

    getDb().prepare('UPDATE logs SET message = ?, detail = ? WHERE id = ?').run(
      'Plex 请求 token=legacy-token', 'Cookie: MUSIC_U=legacy-music; session=legacy-session', entry.id,
    )
    const result = JSON.stringify(readLogs())
    for (const secret of ['legacy-token', 'legacy-music', 'legacy-session']) expect(result).not.toContain(secret)
    expect(readLogs().items[0]?.message).toContain('Plex 请求')
  })
})
