import { getDb } from '../db'
import { normalizePlexPath } from './identity-normalization'

export interface ExtraTrackObservationItem {
  identityKey: string
  ratingKey: string
  plexFilePath: string | null
}

interface ObservationRow {
  identity_key: string
  consecutive_observations: number
  status: 'observing' | 'absent' | 'removed'
  last_run_id: string
}

export function buildExtraTrackObservationKey(ratingKey: string, plexFilePaths: readonly string[]): string {
  const normalizedPath = plexFilePaths
    .map(normalizePlexPath)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0]
  return normalizedPath ? `path:${normalizedPath}` : `rating:${ratingKey}`
}

export function observeExtraTracks(input: {
  sourceId: string
  playlistRatingKey: string
  runId: string
  targetComplete: boolean
  items: readonly ExtraTrackObservationItem[]
}): Map<string, number> {
  const db = getDb()
  const now = new Date().toISOString()
  const scope = [input.sourceId, input.playlistRatingKey] as const
  const uniqueItems = new Map(input.items.map(item => [item.identityKey, item]))

  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT identity_key, consecutive_observations, status, last_run_id
      FROM playlist_extra_observations
      WHERE source_id = ? AND plex_playlist_rating_key = ?
    `).all(...scope) as ObservationRow[]
    const existing = new Map(rows.map(row => [row.identity_key, row]))

    if (!input.targetComplete) {
      db.prepare(`
        UPDATE playlist_extra_observations
        SET consecutive_observations = 0, status = 'absent'
        WHERE source_id = ? AND plex_playlist_rating_key = ? AND status != 'removed'
      `).run(...scope)
      return new Map([...uniqueItems.keys()].map(key => [key, 0]))
    }

    const markAbsent = db.prepare(`
      UPDATE playlist_extra_observations
      SET consecutive_observations = 0, status = 'absent'
      WHERE source_id = ? AND plex_playlist_rating_key = ? AND identity_key = ?
    `)
    for (const row of rows) {
      if (!uniqueItems.has(row.identity_key) && row.status !== 'removed') {
        markAbsent.run(...scope, row.identity_key)
      }
    }

    const upsert = db.prepare(`
      INSERT INTO playlist_extra_observations (
        source_id, plex_playlist_rating_key, identity_key, plex_rating_key,
        plex_file_path, consecutive_observations, status, first_seen_at,
        last_seen_at, last_run_id, removed_at, removed_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'observing', ?, ?, ?, NULL, NULL)
      ON CONFLICT(source_id, plex_playlist_rating_key, identity_key) DO UPDATE SET
        plex_rating_key = excluded.plex_rating_key,
        plex_file_path = excluded.plex_file_path,
        consecutive_observations = excluded.consecutive_observations,
        status = 'observing',
        last_seen_at = excluded.last_seen_at,
        last_run_id = excluded.last_run_id,
        removed_at = NULL,
        removed_run_id = NULL
    `)
    const counts = new Map<string, number>()
    for (const item of uniqueItems.values()) {
      const row = existing.get(item.identityKey)
      const count = row?.last_run_id === input.runId
        ? (row.status === 'observing' ? row.consecutive_observations : 1)
        : row?.status === 'observing'
          ? row.consecutive_observations + 1
          : 1
      upsert.run(
        input.sourceId,
        input.playlistRatingKey,
        item.identityKey,
        item.ratingKey,
        item.plexFilePath,
        count,
        now,
        now,
        input.runId,
      )
      counts.set(item.identityKey, count)
    }
    return counts
  })()
}

export function getExtraTrackObservationCounts(sourceId: string, playlistRatingKey: string): Map<string, number> {
  const rows = getDb().prepare(`
    SELECT identity_key, consecutive_observations, status
    FROM playlist_extra_observations
    WHERE source_id = ? AND plex_playlist_rating_key = ?
  `).all(sourceId, playlistRatingKey) as Array<Pick<ObservationRow, 'identity_key' | 'consecutive_observations' | 'status'>>
  return new Map(rows.map(row => [
    row.identity_key,
    row.status === 'observing' ? row.consecutive_observations : 0,
  ]))
}

export function markExtraTrackObservationsRemoved(
  sourceId: string,
  playlistRatingKey: string,
  runId: string,
  identityKeys: readonly string[],
): void {
  if (identityKeys.length === 0) return
  const now = new Date().toISOString()
  const update = getDb().prepare(`
    UPDATE playlist_extra_observations
    SET status = 'removed', consecutive_observations = 0,
        removed_at = ?, removed_run_id = ?
    WHERE source_id = ? AND plex_playlist_rating_key = ? AND identity_key = ?
  `)
  getDb().transaction(() => {
    for (const identityKey of new Set(identityKeys)) {
      update.run(now, runId, sourceId, playlistRatingKey, identityKey)
    }
  })()
}
