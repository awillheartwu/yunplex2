import { existsSync } from 'node:fs'
import { getDb } from '../db'
import { searchTrack, getPlaylistTracks, getTrackByRatingKey } from '../plex-client'
import type { NeteaseSong } from '../netease'
import type { TrackResolution, SongLookupRow } from './types'

/**
 * Build a TrackResolution for each song in the Netease playlist.
 *
 * Lookup chain:
 *   DB cache → verify in Plex → searchTrack → disk exists → download/unavailable
 */
export async function resolveTracks(
  yunSongs: NeteaseSong[],
  plexPlaylistRatingKey: string,
  sectionKey: string,
  downloadDir: string,
  splitArtists: (artists: { name: string }[]) => [string, string],
): Promise<{ resolutions: TrackResolution[]; extraTracks: Array<{ playlistItemId: number; title: string; artist: string; album: string }> }> {
  const db = getDb()
  const plexPlaylistTracks = await getPlaylistTracks(plexPlaylistRatingKey, 99999)

  // Build lookup: plexRatingKey → playlistItemID
  const playlistItemMap = new Map<string, number>()
  for (const pt of plexPlaylistTracks) {
    if (pt.playlistItemID) playlistItemMap.set(pt.ratingKey, pt.playlistItemID)
  }

  const resolutions: TrackResolution[] = []
  const usedPlexKeys = new Set<string>()

  for (let i = 0; i < yunSongs.length; i++) {
    const song = yunSongs[i]!
    const [albumArtist] = splitArtists(song.artists)
    const resolution = await resolveOne(song, i, plexPlaylistTracks, playlistItemMap, sectionKey, downloadDir, albumArtist, db)
    resolutions.push(resolution)
    if (resolution.plexRatingKey) usedPlexKeys.add(resolution.plexRatingKey)
  }

  // Extra tracks: in Plex playlist but not matched to any Netease song
  const extraTracks: Array<{ playlistItemId: number; title: string; artist: string; album: string }> = []
  for (const pt of plexPlaylistTracks) {
    if (pt.playlistItemID && !usedPlexKeys.has(pt.ratingKey)) {
      extraTracks.push({ playlistItemId: pt.playlistItemID, title: pt.title, artist: pt.grandparentTitle || '', album: pt.parentTitle || '' })
    }
  }

  return { resolutions, extraTracks }
}

async function resolveOne(
  song: NeteaseSong,
  index: number,
  plexTracks: Array<{ ratingKey: string; title: string; grandparentTitle: string; parentTitle: string; playlistItemID?: number }>,
  playlistItemMap: Map<string, number>,
  sectionKey: string,
  downloadDir: string,
  albumArtist: string,
  db: ReturnType<typeof getDb>,
): Promise<TrackResolution> {
  const base: Omit<TrackResolution, 'resolution'> = { neteaseIndex: index, song }

  // ── Step 1: Check if already in Plex playlist ──
  const inPlaylist = plexTracks.find((pt) =>
    fuzzyMatch(pt.title, song.name) &&
    fuzzyArtist(pt.grandparentTitle, albumArtist) &&
    fuzzyAlbum(pt.parentTitle, song.album.name),
  )
  if (inPlaylist && inPlaylist.playlistItemID) {
    upsertLookup(db, song.id, inPlaylist.ratingKey, null)
    return { ...base, resolution: 'matched_plex_playlist', plexRatingKey: inPlaylist.ratingKey, playlistItemId: inPlaylist.playlistItemID }
  }

  // ── Step 2: Check DB cache ──
  const cached = db.prepare('SELECT * FROM song_lookup WHERE netease_song_id = ?').get(song.id) as SongLookupRow | undefined
  if (cached?.plex_rating_key) {
    // Quick verification: is the cached track still in Plex?
    const stillValid = await quickVerify(cached.plex_rating_key, sectionKey, db, song)
    if (stillValid) {
      return { ...base, resolution: 'found_in_plex_library', plexRatingKey: cached.plex_rating_key }
    }
    // Cache invalid — remove it
    db.prepare('DELETE FROM song_lookup WHERE netease_song_id = ?').run(song.id)
  }

  // ── Step 3: Search Plex library ──
  const found = await searchTrack(sectionKey, song.name, albumArtist, song.album.name)
  if (found) {
    upsertLookup(db, song.id, found.ratingKey, null)
    return { ...base, resolution: 'found_in_plex_library', plexRatingKey: found.ratingKey }
  }

  // ── Step 4: Check disk — build expected path and check existence ──
  const expectedPath = cached?.file_path
  if (expectedPath && existsSync(expectedPath)) {
    upsertLookup(db, song.id, null, expectedPath)
    return { ...base, resolution: 'found_on_disk', filePath: expectedPath }
  }

  // ── Step 5: Downloadable or unavailable ──
  // A song is downloadable if we can get a URL (the caller will handle actual download)
  // For now, mark as needs_download — the caller verifies URL availability
  return { ...base, resolution: 'needs_download' }
}

/** Quick Plex metadata lookup — one cheap API call to verify track still exists */
async function quickVerify(plexRatingKey: string, _sectionKey: string, _db: ReturnType<typeof getDb>, _song: NeteaseSong): Promise<boolean> {
  const track = await getTrackByRatingKey(plexRatingKey)
  return track !== null
}

function upsertLookup(db: ReturnType<typeof getDb>, neteaseSongId: number, plexRatingKey: string | null, filePath: string | null) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO song_lookup (netease_song_id, plex_rating_key, file_path, last_verified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      plex_rating_key = COALESCE(excluded.plex_rating_key, song_lookup.plex_rating_key),
      file_path = COALESCE(excluded.file_path, song_lookup.file_path),
      last_verified_at = excluded.last_verified_at
  `).run(neteaseSongId, plexRatingKey, filePath, now)
}

function normalizeTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
}

function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s'""]+/g, '')
}

function fuzzyMatch(plexTitle: string, yunTitle: string): boolean {
  const y = normalizeTitle(yunTitle)
  const p = normalizeTitle(plexTitle)
  return !!(y && p && (y === p || stripPunct(y) === stripPunct(p)))
}

function fuzzyArtist(plexArtist: string, yunArtist: string): boolean {
  if (!yunArtist || !plexArtist) return true
  const py = yunArtist.toLowerCase()
  const pp = plexArtist.toLowerCase()
  return py === pp || py.includes(pp) || pp.includes(py)
}

function fuzzyAlbum(plexAlbum: string, yunAlbum: string): boolean {
  if (!yunAlbum || !plexAlbum) return true
  const y = normalizeTitle(yunAlbum)
  const p = normalizeTitle(plexAlbum || '')
  return y === p || stripPunct(y) === stripPunct(p) || stripPunct(y).includes(stripPunct(p)) || stripPunct(p).includes(stripPunct(y))
}
