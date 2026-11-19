import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb, readConfigFromDb } from '~~/server/lib/db'
import { applyPlaylistSourceBatchAction } from '~~/server/lib/playlist/batch-actions'
import { getSource } from '~~/server/lib/playlist/store'
import { setSyncService } from '~~/server/lib/sync/instance'
import { getSyncService } from '~~/server/lib/sync/service'

const tempDirs: string[] = []
let sourceSequence = 1000

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-source-batch-'))
  tempDirs.push(dir)
  return dir
}

function setupDb() {
  initDb(createTempDataDir())
  setSyncService(getSyncService(readConfigFromDb))
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
    closeDb()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty ids', async () => {
    await expect(applyPlaylistSourceBatchAction('enable', [])).rejects.toThrow('请选择要操作的同步源')
  })

  it('rejects unsupported actions', async () => {
    await expect(applyPlaylistSourceBatchAction('archive', ['src-1'])).rejects.toThrow('不支持的批量操作')
  })

  it('rejects missing sources', async () => {
    setupDb()

    await expect(applyPlaylistSourceBatchAction('disable', ['missing'])).rejects.toThrow('同步源不存在：missing')
  })

  it('rejects album sources for sync', async () => {
    setupDb()
    insertSource({ id: 'playlist-1', type: 'playlist' })
    insertSource({ id: 'album-1', type: 'album' })

    await expect(applyPlaylistSourceBatchAction('sync', ['playlist-1', 'album-1'])).rejects.toThrow('批量同步仅支持歌单来源')
  })

  it('updates playlist enabled state in bulk', async () => {
    setupDb()
    insertSource({ id: 'playlist-1', enabled: true })
    insertSource({ id: 'playlist-2', enabled: true })

    const result = await applyPlaylistSourceBatchAction('disable', ['playlist-1', 'playlist-2'])

    expect(result).toEqual({ action: 'disable', count: 2, ids: ['playlist-1', 'playlist-2'] })
    expect(getSource('playlist-1')?.enabled).toBe(false)
    expect(getSource('playlist-2')?.enabled).toBe(false)
  })

  it('deletes selected sources while retaining file task history', async () => {
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

    const result = await applyPlaylistSourceBatchAction('delete', ['playlist-1'])

    expect(result.count).toBe(1)
    expect(getSource('playlist-1')).toBeNull()
    expect(getDb().prepare('SELECT id,source_id FROM download_tasks').all()).toEqual([{ id: 'task-1', source_id: null }])
  })

  it('triggers one sync run for selected enabled playlists', async () => {
    setupDb()
    insertSource({ id: 'playlist-1' })
    insertSource({ id: 'playlist-2' })
    const runSync = vi.fn(() => ({ runId: 'run-1' }))
    const result = await applyPlaylistSourceBatchAction('sync', ['playlist-1', 'playlist-2'], {
      isSyncRunning: () => false,
      isRepairRunning: () => false,
      runSync,
    })

    expect(result).toEqual({ action: 'sync', count: 2, ids: ['playlist-1', 'playlist-2'], runId: 'run-1' })
    expect(runSync).toHaveBeenCalledWith(['playlist-1', 'playlist-2'])
  })
})
