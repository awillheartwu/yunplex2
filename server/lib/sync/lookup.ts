import { getDb } from '../db'
import type { AppConfig } from '../config/types'
import { searchTrack, getPlaylistTracks, getTrackByRatingKey, getTrackFilePathByRatingKey } from '../plex-client'
import type { NeteaseSong } from '../netease'
import type { TrackResolution, SongLookupRow } from './types'
import { isArtistNameMatch, anyCandidateMatches, normalizeArtistName } from './artist-match'
import type { ArtistCandidate } from './artist-resolver'
import { clearSongLookupFilePath, deleteSongLookup, getSongLookup } from './song-lookup-store'
import { resolveAccessibleLocalPath } from './path-map'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'
import { titleIdentityDescriptorsCompatible } from './matchers'
import { findExistingLocalSongPath } from './local-file-discovery'

/**
 * Build a TrackResolution for each song in the Netease playlist.
 *
 * Lookup chain:
 *   DB cache → verify in Plex → searchTrack (with MB aliases) → disk exists → download/unavailable
 */
export async function resolveTracks(
  yunSongs: NeteaseSong[],
  plexPlaylistRatingKey: string,
  sectionKey: string,
  cfg: AppConfig,
): Promise<{ resolutions: TrackResolution[]; extraTracks: Array<{ playlistItemId: number; title: string; artist: string; album: string }> }> {
  const db = getDb()
  const plexPlaylistTracks = plexPlaylistRatingKey
    ? await getPlaylistTracks(plexPlaylistRatingKey, 99999)
    : []

  const resolutions: TrackResolution[] = []
  const usedPlexKeys = new Set<string>()
  const claimedBindings = new Map<string, TrackResolution>()

  for (let i = 0; i < yunSongs.length; i++) {
    const song = yunSongs[i]!
    const resolution = await resolveOne(song, i, plexPlaylistTracks, sectionKey, cfg, db)
    const dedupedResolution = dedupeResolutionBinding(resolution, claimedBindings)
    if (dedupedResolution !== resolution) {
      deleteSongLookup(song.id)
    }
    resolutions.push(dedupedResolution)
    if (dedupedResolution.plexRatingKey) usedPlexKeys.add(dedupedResolution.plexRatingKey)
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
  sectionKey: string,
  cfg: AppConfig,
  db: ReturnType<typeof getDb>,
): Promise<TrackResolution> {
  const base: Omit<TrackResolution, 'resolution'> = { neteaseIndex: index, song }

  // ── Resolve all artist candidates once for this song ──
  const artistCandidateNames = await resolveSongArtistCandidateNames(song.artists)
  const artistCandidates = artistCandidateNames.map((name) => ({
    name,
    normalizedName: normalizeArtistName(name),
  }))

  // ── Step 1: Check if already in Plex playlist ──
  const inPlaylist = plexTracks.find((pt) =>
    fuzzyMatchTitle(pt.title, song.name) &&
    anyCandidateMatches(pt.grandparentTitle, artistCandidates) &&
    fuzzyMatchAlbum(pt.parentTitle, song.album.name),
  )
  if (inPlaylist && inPlaylist.playlistItemID) {
    const filePath = await cacheTrackFilePath(db, song.id, inPlaylist.ratingKey, cfg)
    return {
      ...base,
      resolution: 'matched_plex_playlist',
      plexRatingKey: inPlaylist.ratingKey,
      playlistItemId: inPlaylist.playlistItemID,
      filePath: filePath ?? undefined,
    }
  }

  // ── Step 2: Check DB cache ──
  const cached = getSongLookup(song.id) as SongLookupRow | undefined
  if (cached?.plex_rating_key) {
    const verifiedTrack = await quickVerify(cached.plex_rating_key)
    if (verifiedTrack && trackMatchesSong(verifiedTrack, song, artistCandidates)) {
      const filePath = await cacheTrackFilePath(db, song.id, cached.plex_rating_key, cfg)
      return {
        ...base,
        resolution: 'found_in_plex_library',
        plexRatingKey: cached.plex_rating_key,
        filePath: filePath ?? undefined,
      }
    }
    deleteSongLookup(song.id)
  }

  // ── Step 3: Search Plex library (now with resolved artist candidates) ──
  const found = await searchTrack(sectionKey, song.name, artistCandidateNames, song.album.name)
  if (found) {
    const filePath = await cacheTrackFilePath(db, song.id, found.ratingKey, cfg)
    return {
      ...base,
      resolution: 'found_in_plex_library',
      plexRatingKey: found.ratingKey,
      filePath: filePath ?? undefined,
    }
  }

  // ── Step 4: Check disk ──
  const expectedPath = cached?.file_path ?? findExistingLocalSongPath(song, cfg)
  const accessiblePath = resolveAccessibleLocalPath(expectedPath, cfg)
  if (accessiblePath) {
    upsertLookup(db, song.id, null, accessiblePath)
    return { ...base, resolution: 'found_on_disk', filePath: accessiblePath }
  }
  if (expectedPath) {
    clearSongLookupFilePath(song.id)
  }

  // ── Step 5: Downloadable or unavailable ──
  return { ...base, resolution: 'needs_download' }
}

/** Quick Plex metadata lookup — one cheap API call to verify track still exists */
async function quickVerify(plexRatingKey: string) {
  return getTrackByRatingKey(plexRatingKey)
}

async function cacheTrackFilePath(
  db: ReturnType<typeof getDb>,
  neteaseSongId: number,
  plexRatingKey: string,
  cfg: AppConfig,
): Promise<string | null> {
  const plexPath = await getTrackFilePathByRatingKey(plexRatingKey)
  const localPath = resolveAccessibleLocalPath(plexPath, cfg)
  if (localPath) {
    upsertLookup(db, neteaseSongId, plexRatingKey, localPath)
    return localPath
  }

  upsertLookup(db, neteaseSongId, plexRatingKey, null)
  return null
}

export function upsertLookup(db: ReturnType<typeof getDb>, neteaseSongId: number, plexRatingKey: string | null, filePath: string | null) {
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

// ── Title matching (unchanged from original) ──

function normalizeTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
}

function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s‘’“”]+/g, '')
}

function fuzzyMatchTitle(plexTitle: string, yunTitle: string): boolean {
  if (!titleIdentityDescriptorsCompatible(plexTitle, yunTitle)) return false
  const y = normalizeTitle(yunTitle)
  const p = normalizeTitle(plexTitle)
  if (!y || !p) return false

  if (y === p || stripPunct(y) === stripPunct(p)) {
    const yHasExtra = /[([].+[\])]/.test(yunTitle)
    const pHasExtra = /[([].+[\])]/.test(plexTitle)
    if (yHasExtra !== pHasExtra) {
      const base = yHasExtra ? plexTitle : yunTitle
      if (base && base.trim().length <= 3) return false
    }
    return true
  }
  return false
}

function fuzzyMatchAlbum(plexAlbum: string, yunAlbum: string): boolean {
  if (!yunAlbum || !plexAlbum) return true
  const y = normalizeTitle(yunAlbum)
  const p = normalizeTitle(plexAlbum || '')
  return y === p || stripPunct(y) === stripPunct(p) || stripPunct(y).includes(stripPunct(p)) || stripPunct(p).includes(stripPunct(y))
}

// ── Backward-compat exports ──

export { isArtistNameMatch as fuzzyArtist, anyCandidateMatches, normalizeArtistName }
export type { ArtistCandidate }

/** @deprecated — use fuzzyMatchTitle (local) or isArtistNameMatch for artists */
export function fuzzyMatch(plexTitle: string, yunTitle: string): boolean {
  return fuzzyMatchTitle(plexTitle, yunTitle)
}

/** @deprecated — use fuzzyMatchAlbum (local) */
export function fuzzyAlbum(plexAlbum: string, yunAlbum: string): boolean {
  return fuzzyMatchAlbum(plexAlbum, yunAlbum)
}

function trackMatchesSong(
  track: { title: string; grandparentTitle: string; parentTitle: string },
  song: NeteaseSong,
  artistCandidates: ArtistCandidate[],
): boolean {
  return (
    fuzzyMatchTitle(track.title, song.name) &&
    anyCandidateMatches(track.grandparentTitle, artistCandidates) &&
    fuzzyMatchAlbum(track.parentTitle, song.album.name)
  )
}

function dedupeResolutionBinding(
  resolution: TrackResolution,
  claimedBindings: Map<string, TrackResolution>,
): TrackResolution {
  const bindingKeys = [resolution.plexRatingKey, resolution.filePath].filter(Boolean) as string[]
  for (const bindingKey of bindingKeys) {
    const claimed = claimedBindings.get(bindingKey)
    if (!claimed) continue
    if (claimed.song.id === resolution.song.id) continue
    return {
      neteaseIndex: resolution.neteaseIndex,
      song: resolution.song,
      resolution: 'needs_download',
    }
  }

  for (const bindingKey of bindingKeys) {
    claimedBindings.set(bindingKey, resolution)
  }
  return resolution
}
