import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, initDb } from '../db'
import { applyPlaylistSourceBatchAction } from './batch-actions'
import { getSource } from './store'

const tempDirs: string[] = []
let sourceSequence = 1000

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-source-batch-'))
  tempDirs.push(dir)
  return dir
}

function setupDb() {
  initDb(createTempDataDir())
}

function insertSource(partial: {
  id: string
  type?: 'playlist' | 'album'
  enabled?: boolean
  sortOrder?: number
}) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id,
      netease_playlist_id,
      name,
      netease_playlist_name,
      type,
      subscribed,
      enabled,
      cover_url,
      plex_playlist_name,
      plex_playlist_rating_key,
      sync_limit,
      last_synced_at,
      last_status,
      last_error,
      auto_create_plex_playlist,
      track_count,
      sort_order,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, '', ?, '', NULL, NULL, 'idle', NULL, 1, 0, ?, ?, ?)
  `).run(
    partial.id,
    sourceSequence++,
    `${partial.id} task`,
    `${partial.id} source`,
    partial.type ?? 'playlist',
    partial.enabled === false ? 0 : 1,
    `${partial.id} plex`,
    partial.sortOrder ?? 1,
    now,
    now,
  )
}

describe('playlist source batch actions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty ids', () => {
    expect(() => applyPlaylistSourceBatchAction('enable', [])).toThrow('请选择要操作的同步源')
  })

  it('rejects unsupported actions', () => {
    expect(() => applyPlaylistSourceBatchAction('archive', ['src-1'])).toThrow('不支持的批量操作')
  })

  it('rejects missing sources', () => {
    setupDb()

    expect(() => applyPlaylistSourceBatchAction('disable', ['missing'])).toThrow('同步源不存在：missing')
  })

  it('rejects album sources for sync', () => {
    setupDb()
    insertSource({ id: 'playlist-1', type: 'playlist' })
    insertSource({ id: 'album-1', type: 'album' })

    expect(() => applyPlaylistSourceBatchAction('sync', ['playlist-1', 'album-1'])).toThrow('批量同步仅支持歌单来源')
  })

  it('updates playlist enabled state in bulk', () => {
    setupDb()
    insertSource({ id: 'playlist-1', enabled: true })
    insertSource({ id: 'playlist-2', enabled: true })

    const result = applyPlaylistSourceBatchAction('disable', ['playlist-1', 'playlist-2'], {
      recordActivity: vi.fn(),
    })

    expect(result).toEqual({ action: 'disable', count: 2, ids: ['playlist-1', 'playlist-2'] })
    expect(getSource('playlist-1')?.enabled).toBe(false)
    expect(getSource('playlist-2')?.enabled).toBe(false)
  })

  it('deletes selected sources and cascades download tasks', () => {
    setupDb()
    insertSource({ id: 'playlist-1' })
    getDb().prepare(`
      INSERT INTO download_tasks (
        id,
        source_id,
        song_id,
        song_name,
        artist,
        album,
        status,
        progress,
        created_at,
        updated_at
      )
      VALUES ('task-1', 'playlist-1', 1, 'Song', 'Artist', 'Album', 'done', 100, ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString())

    const result = applyPlaylistSourceBatchAction('delete', ['playlist-1'], {
      recordActivity: vi.fn(),
    })

    expect(result.count).toBe(1)
    expect(getSource('playlist-1')).toBeNull()
    expect((getDb().prepare('SELECT COUNT(*) as count FROM download_tasks').get() as { count: number }).count).toBe(0)
  })

  it('triggers one sync run for selected enabled playlists', () => {
    setupDb()
    insertSource({ id: 'playlist-1' })
    insertSource({ id: 'playlist-2' })
    const runSync = vi.fn()

    const result = applyPlaylistSourceBatchAction('sync', ['playlist-1', 'playlist-2'], {
      isSyncRunning: () => false,
      isRepairRunning: () => false,
      runSync,
      recordActivity: vi.fn(),
    })

    expect(result).toEqual({ action: 'sync', count: 2, ids: ['playlist-1', 'playlist-2'] })
    expect(runSync).toHaveBeenCalledWith(['playlist-1', 'playlist-2'])
  })
})
