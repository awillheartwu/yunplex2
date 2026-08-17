import { getDb } from '../db'
import type { PlaylistSource, PlaylistSourceRow } from './types'
import { rowToSource } from './types'
import { randomUUID } from 'node:crypto'

export interface PlaylistSourceFilter {
  search?: string
  type?: 'playlist' | 'album'
  enabled?: boolean
  subscribed?: boolean
  lastStatus?: PlaylistSource['lastStatus']
  hasIgnored?: boolean
  hasCopyright?: boolean
}

function sourceHasDataCondition(column: string, hasData: boolean): string {
  const nonEmpty = `${column} IS NOT NULL AND TRIM(${column}) != '' AND TRIM(${column}) != '[]'`
  return hasData ? `(${nonEmpty})` : `NOT (${nonEmpty})`
}

export function listSources(filter: boolean | PlaylistSourceFilter = false): PlaylistSource[] {
  const db = getDb()
  const normalized: PlaylistSourceFilter = typeof filter === 'boolean' ? { enabled: filter || undefined } : filter
  const conditions: string[] = []
  const params: unknown[] = []

  const search = normalized.search?.trim()
  if (search) {
    const q = `%${search.toLowerCase()}%`
    conditions.push(`(
      LOWER(name) LIKE ?
      OR LOWER(netease_playlist_name) LIKE ?
      OR LOWER(plex_playlist_name) LIKE ?
      OR CAST(netease_playlist_id AS TEXT) LIKE ?
      OR LOWER(id) LIKE ?
    )`)
    params.push(q, q, q, `%${search}%`, q)
  }
  if (normalized.type) {
    conditions.push('type = ?')
    params.push(normalized.type)
  }
  if (normalized.enabled !== undefined) {
    conditions.push('enabled = ?')
    params.push(normalized.enabled ? 1 : 0)
  }
  if (normalized.subscribed !== undefined) {
    conditions.push('subscribed = ?')
    params.push(normalized.subscribed ? 1 : 0)
  }
  if (normalized.lastStatus) {
    conditions.push('last_status = ?')
    params.push(normalized.lastStatus)
  }
  if (normalized.hasIgnored !== undefined) {
    conditions.push(sourceHasDataCondition('ignored_failure_ids', normalized.hasIgnored))
  }
  if (normalized.hasCopyright !== undefined) {
    conditions.push(sourceHasDataCondition('copyright_restricted_ids', normalized.hasCopyright))
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM playlist_sources ${where} ORDER BY sort_order ASC, created_at ASC`).all(...params) as PlaylistSourceRow[]
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
  opts?: { type?: 'playlist' | 'album'; subscribed?: boolean; trackCount?: number; name?: string; artist?: string; coverUrl?: string },
): Promise<PlaylistSource> {
  const isAlbum = opts?.type === 'album'
  const neName = isAlbum
    ? opts?.name || null
    : await fetchPlaylistName(neteasePlaylistId)
  const taskName = neName ? `${neName}任务` : '(待获取)'
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) as mx FROM playlist_sources').get() as { mx: number }).mx

  db.prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, netease_playlist_name, type, subscribed, enabled, cover_url, plex_playlist_name, plex_playlist_rating_key, sync_limit, last_synced_at, last_status, last_error, auto_create_plex_playlist, track_count, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, 'idle', NULL, 1, ?, ?, ?, ?)
  `).run(id, neteasePlaylistId, taskName, neName || '', isAlbum ? 'album' : 'playlist', opts?.subscribed ? 1 : 0, isAlbum ? 0 : 1, opts?.coverUrl || '', neName || '', opts?.trackCount || 0, maxOrder + 1, now, now)

  return getSource(id)!
}

export function updateSource(id: string, partial: Partial<{
  name: string
  neteasePlaylistName: string
  enabled: boolean
  coverUrl: string
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
  forceFullCompare: boolean | null
  consecutiveSkips: number
  fullCompareAfterSkips: number | null
  fullCompareAfterDays: number | null
  skipPlexPlaylist: boolean | null
  skipRemoveExtraTracks: boolean | null
  copyrightRestrictedIds: string | null
  ignoredFailureIds: string | null
  requiresMatchReconcile: boolean
  lastFullCompareAt: string | null
  plexUpdatedAt: number | null
  trackIdSnapshot: string | null
  lastObservedPlexFingerprint: string | null
  lastAppliedPlexFingerprint: string | null
  lastObservedNeteaseCursor: string | null
  lastComparedNeteaseCursor: string | null
  lastObservedAt: string | null
  lastComparedAt: string | null
  sortOrder: number
}>): PlaylistSource | null {
  const db = getDb()
  const sets: string[] = []
  const vals: unknown[] = []

  if (partial.name !== undefined) { sets.push('name = ?'); vals.push(partial.name) }
  if (partial.neteasePlaylistName !== undefined) { sets.push('netease_playlist_name = ?'); vals.push(partial.neteasePlaylistName) }
  if (partial.enabled !== undefined) { sets.push('enabled = ?'); vals.push(partial.enabled ? 1 : 0) }
  if (partial.coverUrl !== undefined) { sets.push('cover_url = ?'); vals.push(partial.coverUrl) }
  if (partial.plexPlaylistName !== undefined) { sets.push('plex_playlist_name = ?'); vals.push(partial.plexPlaylistName) }
  if (partial.plexPlaylistRatingKey !== undefined) { sets.push('plex_playlist_rating_key = ?'); vals.push(partial.plexPlaylistRatingKey) }
  if (partial.syncLimit !== undefined) { sets.push('sync_limit = ?'); vals.push(partial.syncLimit) }
  if (partial.lastSyncedAt !== undefined) { sets.push('last_synced_at = ?'); vals.push(partial.lastSyncedAt) }
  if (partial.lastStatus !== undefined) { sets.push('last_status = ?'); vals.push(partial.lastStatus) }
  if (partial.lastError !== undefined) { sets.push('last_error = ?'); vals.push(partial.lastError) }
  if (partial.lastJobId !== undefined) { sets.push('last_job_id = ?'); vals.push(partial.lastJobId) }
  if (partial.autoCreatePlexPlaylist !== undefined) { sets.push('auto_create_plex_playlist = ?'); vals.push(partial.autoCreatePlexPlaylist ? 1 : 0) }
  if (partial.trackCount !== undefined) { sets.push('track_count = ?'); vals.push(partial.trackCount) }
  if (partial.forceFullCompare !== undefined) { sets.push('force_full_compare = ?'); vals.push(toNullableBoolean(partial.forceFullCompare)) }
  if (partial.consecutiveSkips !== undefined) { sets.push('consecutive_skips = ?'); vals.push(partial.consecutiveSkips) }
  if (partial.fullCompareAfterSkips !== undefined) { sets.push('full_compare_after_skips = ?'); vals.push(partial.fullCompareAfterSkips) }
  if (partial.fullCompareAfterDays !== undefined) { sets.push('full_compare_after_days = ?'); vals.push(partial.fullCompareAfterDays) }
  if (partial.skipPlexPlaylist !== undefined) { sets.push('skip_plex_playlist = ?'); vals.push(toNullableBoolean(partial.skipPlexPlaylist)) }
  if (partial.skipRemoveExtraTracks !== undefined) { sets.push('skip_remove_extra_tracks = ?'); vals.push(toNullableBoolean(partial.skipRemoveExtraTracks)) }
  if (partial.copyrightRestrictedIds !== undefined) { sets.push('copyright_restricted_ids = ?'); vals.push(partial.copyrightRestrictedIds) }
  if (partial.ignoredFailureIds !== undefined) { sets.push('ignored_failure_ids = ?'); vals.push(partial.ignoredFailureIds) }
  if (partial.requiresMatchReconcile !== undefined) { sets.push('requires_match_reconcile = ?'); vals.push(partial.requiresMatchReconcile ? 1 : 0) }
  if (partial.lastFullCompareAt !== undefined) { sets.push('last_full_compare_at = ?'); vals.push(partial.lastFullCompareAt) }
  if (partial.plexUpdatedAt !== undefined) { sets.push('plex_updated_at = ?'); vals.push(partial.plexUpdatedAt) }
  if (partial.trackIdSnapshot !== undefined) { sets.push('track_id_snapshot = ?'); vals.push(partial.trackIdSnapshot) }
  if (partial.lastObservedPlexFingerprint !== undefined) { sets.push('last_observed_plex_fingerprint = ?'); vals.push(partial.lastObservedPlexFingerprint) }
  if (partial.lastAppliedPlexFingerprint !== undefined) { sets.push('last_applied_plex_fingerprint = ?'); vals.push(partial.lastAppliedPlexFingerprint) }
  if (partial.lastObservedNeteaseCursor !== undefined) { sets.push('last_observed_netease_cursor = ?'); vals.push(partial.lastObservedNeteaseCursor) }
  if (partial.lastComparedNeteaseCursor !== undefined) { sets.push('last_compared_netease_cursor = ?'); vals.push(partial.lastComparedNeteaseCursor) }
  if (partial.lastObservedAt !== undefined) { sets.push('last_observed_at = ?'); vals.push(partial.lastObservedAt) }
  if (partial.lastComparedAt !== undefined) { sets.push('last_compared_at = ?'); vals.push(partial.lastComparedAt) }
  if (partial.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(partial.sortOrder) }
  if (partial.lastTrackUpdateTime !== undefined) { sets.push('last_track_update_time = ?'); vals.push(partial.lastTrackUpdateTime) }

  if (sets.length === 0) return getSource(id)

  sets.push('updated_at = ?')
  vals.push(new Date().toISOString())
  vals.push(id)

  db.prepare(`UPDATE playlist_sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getSource(id)
}

function toNullableBoolean(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0
}

export interface SourceSyncObservation {
  neteaseCursor?: string | null
  plexFingerprint?: string | null
  observedAt?: string
}

/** Records source state fetched from upstream without implying reconciliation success. */
export function recordSourceObservation(id: string, observation: SourceSyncObservation): PlaylistSource | null {
  const observedAt = observation.observedAt ?? new Date().toISOString()
  return updateSource(id, {
    ...(observation.neteaseCursor !== undefined
      ? { lastObservedNeteaseCursor: observation.neteaseCursor }
      : {}),
    ...(observation.plexFingerprint !== undefined
      ? { lastObservedPlexFingerprint: observation.plexFingerprint }
      : {}),
    lastObservedAt: observedAt,
  })
}

export interface SourceSyncComparison {
  neteaseCursor: string
  plexFingerprint?: string | null
  comparedAt?: string
}

/**
 * Records that identity comparison ran for an observed target snapshot. This
 * deliberately does not update `trackIdSnapshot`, which remains the converged
 * baseline used by legacy incremental diff logic.
 */
export function recordSourceComparison(id: string, comparison: SourceSyncComparison): PlaylistSource | null {
  const comparedAt = comparison.comparedAt ?? new Date().toISOString()
  return updateSource(id, {
    lastObservedNeteaseCursor: comparison.neteaseCursor,
    lastComparedNeteaseCursor: comparison.neteaseCursor,
    ...(comparison.plexFingerprint !== undefined
      ? { lastObservedPlexFingerprint: comparison.plexFingerprint }
      : {}),
    lastObservedAt: comparedAt,
    lastComparedAt: comparedAt,
  })
}

/**
 * Persists only a Plex state that was read back after our mutation completed.
 * Setting observed and applied together makes the next observation recognizable
 * as our own write instead of external drift.
 */
export function recordAppliedPlexPlaylistFingerprint(
  id: string,
  fingerprint: string,
  appliedAt = new Date().toISOString(),
): PlaylistSource | null {
  return updateSource(id, {
    lastObservedPlexFingerprint: fingerprint,
    lastAppliedPlexFingerprint: fingerprint,
    lastObservedAt: appliedAt,
  })
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
  // Cascade: clean up orphaned download tasks
  db.prepare('DELETE FROM download_tasks WHERE source_id = ?').run(id)
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
