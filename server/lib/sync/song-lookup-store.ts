import { getDb } from '../db'

export interface SongLookupRecord {
  netease_song_id: number
  plex_rating_key: string | null
  file_path: string | null
  last_verified_at: string
}

export function getSongLookup(neteaseSongId: number): SongLookupRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM song_lookup WHERE netease_song_id = ?')
    .get(neteaseSongId) as SongLookupRecord | undefined
}

export function deleteSongLookup(neteaseSongId: number): void {
  getDb().prepare('DELETE FROM song_lookup WHERE netease_song_id = ?').run(neteaseSongId)
}

export function clearSongLookupFilePath(neteaseSongId: number): void {
  getDb().prepare('UPDATE song_lookup SET file_path = NULL, last_verified_at = ? WHERE netease_song_id = ?')
    .run(new Date().toISOString(), neteaseSongId)
}

export function deleteSongLookups(songIds: number[]): number {
  const uniqueIds = [...new Set(songIds)].filter((id) => Number.isFinite(id))
  if (uniqueIds.length === 0) return 0

  const stmt = getDb().prepare('DELETE FROM song_lookup WHERE netease_song_id = ?')
  const tx = getDb().transaction((ids: number[]) => {
    let removed = 0
    for (const id of ids) {
      const result = stmt.run(id)
      removed += result.changes
    }
    return removed
  })

  return tx(uniqueIds)
}

/**
 * Clear only performance-cache rows that have not been promoted to a durable
 * identity. Used by "rebuild matching" after the live validation pass so a
 * valid legacy path can migrate before its cache row disappears.
 */
export function deleteUnboundSongLookups(songIds: number[]): number {
  const uniqueIds = [...new Set(songIds)].filter(Number.isFinite)
  if (uniqueIds.length === 0) return 0
  const placeholders = uniqueIds.map(() => '?').join(', ')
  const result = getDb().prepare(`
    DELETE FROM song_lookup
    WHERE netease_song_id IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM song_identity_bindings binding
        WHERE binding.netease_song_id = song_lookup.netease_song_id
          AND binding.status = 'active'
      )
  `).run(...uniqueIds)
  return result.changes
}

export function getSongLookupRatingKeys(songIds: number[]): Map<number, string> {
  const uniqueIds = [...new Set(songIds)].filter((id) => Number.isFinite(id))
  const result = new Map<number, string>()
  if (uniqueIds.length === 0) return result

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(`SELECT netease_song_id, plex_rating_key FROM song_lookup WHERE netease_song_id IN (${placeholders})`)
    .all(...uniqueIds) as Array<{ netease_song_id: number; plex_rating_key: string | null }>

  for (const row of rows) {
    if (row.plex_rating_key) result.set(row.netease_song_id, row.plex_rating_key)
  }
  return result
}
