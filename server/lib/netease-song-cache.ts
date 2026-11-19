import { getDb } from './db'
import { findInvalidRawSongField, type RawSong } from './netease'

/** Load raw song rows so sync can remap aliases without refetching details. */
export function loadNeteaseRawSongs(songIds: readonly number[]): Map<number, RawSong> {
  const ids = [...new Set(songIds.filter(id => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return new Map()

  const rows = getDb().prepare(`
    SELECT netease_song_id, raw_json
    FROM netease_song_details
    WHERE netease_song_id IN (${ids.map(() => '?').join(', ')})
  `).all(...ids) as Array<{ netease_song_id: number; raw_json: string }>

  const result = new Map<number, RawSong>()
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.raw_json) as RawSong
      if (raw.id !== row.netease_song_id || findInvalidRawSongField(raw)) continue
      // Refetch rows that would produce an unsafe path or a weak match. This
      // also retries the optional publish-time lookup after an upstream miss.
      if (!raw.name.trim() || !raw.al) continue
      if ((raw.dt ?? 0) <= 0) continue
      if ((raw.publishTime ?? raw.al?.publishTime ?? 0) <= 0) continue
      result.set(raw.id, raw)
    } catch {
      // A malformed row stays unresolved and is refetched as a missing detail.
    }
  }
  return result
}

export function saveNeteaseRawSongs(songs: readonly RawSong[]): void {
  if (songs.length === 0) return
  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO netease_song_details (netease_song_id, raw_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `)
  const updatedAt = new Date().toISOString()
  db.transaction(() => {
    for (const song of songs) {
      if (!Number.isInteger(song.id) || song.id <= 0) continue
      upsert.run(song.id, JSON.stringify(song), updatedAt)
    }
  })()
}
