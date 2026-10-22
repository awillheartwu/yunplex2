import type { NeteaseSong } from '../netease'
import { getTrackByRatingKey } from '../plex-client'
import { plexPathsExactlyEqual } from './identity-normalization'
import type { AppConfig } from '../config/types'
import { isPlexMediaPathAvailable, isPlexTrackAvailable } from '../plex-media'

export interface CachedRatingKeyValidationIssue {
  songId: number
  ratingKey?: string
  reason: 'missing_cache' | 'missing_plex_track' | 'identity_path_mismatch'
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
  config?: AppConfig,
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
    if (!track || !isPlexTrackAvailable(track)) {
      issues.push({ songId: song.id, ratingKey, reason: 'missing_plex_track' })
      continue
    }

    const bindingPath = bindingPaths.get(song.id)
    if (!bindingPath) {
      issues.push({ songId: song.id, ratingKey, reason: 'missing_cache' })
      continue
    }
    if (config && !isPlexMediaPathAvailable(bindingPath, config)) {
      issues.push({ songId: song.id, ratingKey, reason: 'missing_plex_track' })
      continue
    }
    const actualPaths = track.Media?.flatMap(media =>
      media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
    ) ?? []
    if (actualPaths.some(actualPath => plexPathsExactlyEqual(actualPath, bindingPath))) {
      targetOrder.push(ratingKey)
      continue
    }
    issues.push({ songId: song.id, ratingKey, reason: 'identity_path_mismatch' })
  }

  return {
    targetOrder: issues.length === 0 ? [...new Set(targetOrder)] : null,
    issues,
  }
}
