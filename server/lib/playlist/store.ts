import { getDb } from '../db'
import type { PlaylistSource, PlaylistSourceRow } from './types'
import { rowToSource } from './types'
import { randomUUID } from 'node:crypto'

export function listSources(enabledOnly = false): PlaylistSource[] {
  const db = getDb()
  const sql = enabledOnly
    ? 'SELECT * FROM playlist_sources WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM playlist_sources ORDER BY sort_order ASC, created_at ASC'
  const rows = db.prepare(sql).all() as PlaylistSourceRow[]
  return rows.map(rowToSource)
}

export function getSource(id: string): PlaylistSource | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM playlist_sources WHERE id = ?').get(id) as PlaylistSourceRow | undefined
  return row ? rowToSource(row) : null
}

export function getEnabledSources(): PlaylistSource[] {
  return listSources(true)
}

export async function createSource(
  neteasePlaylistId: number,
  _cookie: string,
): Promise<PlaylistSource> {
  const neName = await fetchPlaylistName(neteasePlaylistId)
  const taskName = neName ? `${neName}任务` : '(待获取)'
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) as mx FROM playlist_sources').get() as { mx: number }).mx

  db.prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, netease_playlist_name, enabled, plex_playlist_name, plex_playlist_rating_key, sync_limit, last_synced_at, last_status, last_error, auto_create_plex_playlist, track_count, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, '', NULL, NULL, 'idle', NULL, 1, 0, ?, ?, ?)
  `).run(id, neteasePlaylistId, taskName, neName || '', neName || '', maxOrder + 1, now, now)

  return getSource(id)!
}

export function updateSource(id: string, partial: Partial<{
  name: string
  neteasePlaylistName: string
  enabled: boolean
  plexPlaylistName: string
  plexPlaylistRatingKey: string
  syncLimit: number | null
  lastSyncedAt: string | null
  lastStatus: PlaylistSource['lastStatus']
  lastError: string | null
  lastJobId: string | null
  autoCreatePlexPlaylist: boolean
  trackCount: number
  lastTrackUpdateTime: number | null
  forceFullCompare: boolean
  consecutiveSkips: number
  fullCompareAfterSkips: number | null
  fullCompareAfterDays: number | null
  lastFullCompareAt: string | null
  plexUpdatedAt: number | null
  trackIdSnapshot: string | null
  sortOrder: number
}>): PlaylistSource | null {
  const db = getDb()
  const sets: string[] = []
  const vals: unknown[] = []

  if (partial.name !== undefined) { sets.push('name = ?'); vals.push(partial.name) }
  if (partial.neteasePlaylistName !== undefined) { sets.push('netease_playlist_name = ?'); vals.push(partial.neteasePlaylistName) }
  if (partial.enabled !== undefined) { sets.push('enabled = ?'); vals.push(partial.enabled ? 1 : 0) }
  if (partial.plexPlaylistName !== undefined) { sets.push('plex_playlist_name = ?'); vals.push(partial.plexPlaylistName) }
  if (partial.plexPlaylistRatingKey !== undefined) { sets.push('plex_playlist_rating_key = ?'); vals.push(partial.plexPlaylistRatingKey) }
  if (partial.syncLimit !== undefined) { sets.push('sync_limit = ?'); vals.push(partial.syncLimit) }
  if (partial.lastSyncedAt !== undefined) { sets.push('last_synced_at = ?'); vals.push(partial.lastSyncedAt) }
  if (partial.lastStatus !== undefined) { sets.push('last_status = ?'); vals.push(partial.lastStatus) }
  if (partial.lastError !== undefined) { sets.push('last_error = ?'); vals.push(partial.lastError) }
  if (partial.lastJobId !== undefined) { sets.push('last_job_id = ?'); vals.push(partial.lastJobId) }
  if (partial.autoCreatePlexPlaylist !== undefined) { sets.push('auto_create_plex_playlist = ?'); vals.push(partial.autoCreatePlexPlaylist ? 1 : 0) }
  if (partial.trackCount !== undefined) { sets.push('track_count = ?'); vals.push(partial.trackCount) }
  if (partial.forceFullCompare !== undefined) { sets.push('force_full_compare = ?'); vals.push(partial.forceFullCompare ? 1 : 0) }
  if (partial.consecutiveSkips !== undefined) { sets.push('consecutive_skips = ?'); vals.push(partial.consecutiveSkips) }
  if (partial.fullCompareAfterSkips !== undefined) { sets.push('full_compare_after_skips = ?'); vals.push(partial.fullCompareAfterSkips) }
  if (partial.fullCompareAfterDays !== undefined) { sets.push('full_compare_after_days = ?'); vals.push(partial.fullCompareAfterDays) }
  if (partial.lastFullCompareAt !== undefined) { sets.push('last_full_compare_at = ?'); vals.push(partial.lastFullCompareAt) }
  if (partial.plexUpdatedAt !== undefined) { sets.push('plex_updated_at = ?'); vals.push(partial.plexUpdatedAt) }
  if (partial.trackIdSnapshot !== undefined) { sets.push('track_id_snapshot = ?'); vals.push(partial.trackIdSnapshot) }
  if (partial.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(partial.sortOrder) }
  if (partial.lastTrackUpdateTime !== undefined) { sets.push('last_track_update_time = ?'); vals.push(partial.lastTrackUpdateTime) }

  if (sets.length === 0) return getSource(id)

  sets.push('updated_at = ?')
  vals.push(new Date().toISOString())
  vals.push(id)

  db.prepare(`UPDATE playlist_sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getSource(id)
}

export function reorderSources(orderedIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE playlist_sources SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  const runAll = db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, now, id))
  })
  runAll()
}

export function deleteSource(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM playlist_sources WHERE id = ?').run(id)
  return result.changes > 0
}

async function fetchPlaylistName(playlistId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/api/v1/playlist/detail?id=${playlistId}`)
    const body = (await res.json()) as { playlist?: { name?: string } }
    return body.playlist?.name ?? null
  } catch { return null }
}
