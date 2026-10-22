import type { AppConfig } from '../config/types'
import type { PlexTrack } from '../plex-client'
import { isPlexMediaPathAvailable, isPlexTrackAvailable } from '../plex-media'
import { deleteSongIdentityBinding, type SongIdentityBinding } from './identity-store'
import { resolvePlexIdentityPath } from './identity-normalization'
import { removeMissingLocalMediaAsset } from './local-media-store'

/** Return unavailable song identities; preview only excludes them in memory. */
export function pruneUnavailableSongBindings(
  bindings: Iterable<SongIdentityBinding>,
  tracks: readonly PlexTrack[],
  config: AppConfig,
  dryRun: boolean,
): Set<number> {
  const deletedKeys = new Set(tracks.filter(track => !isPlexTrackAvailable(track)).map(track => track.ratingKey))
  const removed = new Set<number>()
  for (const binding of bindings) {
    const path = resolvePlexIdentityPath({ relativePath: binding.plexRelativePath,
      currentSectionRoot: config.download.plexLibraryPathPrefix, lastObservedPath: binding.plexFilePath })
    if (!deletedKeys.has(binding.plexRatingKey ?? '') && isPlexMediaPathAvailable(path, config)) continue
    if (!dryRun) {
      deleteSongIdentityBinding(binding)
      removeMissingLocalMediaAsset(binding.neteaseSongId)
    }
    removed.add(binding.neteaseSongId)
  }
  return removed
}
