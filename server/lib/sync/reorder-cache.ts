import type { NeteaseSong } from '../netease'
import { getTrackByRatingKey } from '../plex-client'
import { anyCandidateMatches, fuzzyAlbum, fuzzyMatch, normalizeArtistName } from './lookup'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'

export function buildCachedTargetOrder(songIds: number[], ratingKeys: Map<number, string>): string[] | null {
  const targetOrder: string[] = []
  for (const songId of songIds) {
    const ratingKey = ratingKeys.get(songId)
    if (!ratingKey) return null
    targetOrder.push(ratingKey)
  }
  return targetOrder
}

export interface CachedRatingKeyValidationIssue {
  songId: number
  ratingKey?: string
  reason: 'missing_cache' | 'missing_plex_track' | 'metadata_mismatch' | 'identity_path_mismatch'
  titleMatched?: boolean
  artistMatched?: boolean
  albumMatched?: boolean
}

export interface CachedTargetOrderValidation {
  targetOrder: string[] | null
  issues: CachedRatingKeyValidationIssue[]
}

export async function validateCachedTargetOrder(
  songs: NeteaseSong[],
  ratingKeys: Map<number, string>,
  verifyTrack: typeof getTrackByRatingKey = getTrackByRatingKey,
  bindingPaths: Map<number, string> = new Map(),
): Promise<CachedTargetOrderValidation> {
  const targetOrder: string[] = []
  const issues: CachedRatingKeyValidationIssue[] = []

  for (const song of songs) {
    const ratingKey = ratingKeys.get(song.id)
    if (!ratingKey) {
      issues.push({ songId: song.id, reason: 'missing_cache' })
      continue
    }

    const track = await verifyTrack(ratingKey)
    if (!track) {
      issues.push({ songId: song.id, ratingKey, reason: 'missing_plex_track' })
      continue
    }

    const bindingPath = bindingPaths.get(song.id)
    if (bindingPath) {
      const actualPaths = track.Media?.flatMap(media =>
        media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
      ) ?? []
      const normalize = (value: string) => value.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
      if (actualPaths.some(actualPath => normalize(actualPath) === normalize(bindingPath))) {
        targetOrder.push(ratingKey)
        continue
      }
      issues.push({ songId: song.id, ratingKey, reason: 'identity_path_mismatch' })
      continue
    }

    const artistNames = await resolveSongArtistCandidateNames(song.artists)
    const artistCandidates = artistNames.map((name) => ({
      name,
      normalizedName: normalizeArtistName(name),
      source: 'original' as const,
      confidence: 100,
    }))
    const titleMatched = fuzzyMatch(track.title, song.name)
    const artistMatched = anyCandidateMatches(track.grandparentTitle, artistCandidates)
    const albumMatched = fuzzyAlbum(track.parentTitle, song.album.name)

    if (!titleMatched || !artistMatched || !albumMatched) {
      issues.push({
        songId: song.id,
        ratingKey,
        reason: 'metadata_mismatch',
        titleMatched,
        artistMatched,
        albumMatched,
      })
      continue
    }

    targetOrder.push(ratingKey)
  }

  return {
    targetOrder: issues.length === 0 ? targetOrder : null,
    issues,
  }
}
