import type { PlaylistSource } from '../playlist/types'
import { getSongIdentityBindings } from './identity-store'
import {
  diffOrderedSnapshot,
  findChangedPlexRatingKeys,
  parseOrderedSnapshot,
  parsePlexPathSnapshot,
} from './playlist-fingerprint'

export interface PlexPathDrift {
  changedRatingKeys: Set<string>
  detected: boolean
}

export function detectPlexPathDrift(input: {
  appliedPaths: string | null | undefined
  observedPaths: string | null | undefined
  enabled: boolean
  isAlbum: boolean
  dryRun: boolean
  hasPlexPlaylist: boolean
}): PlexPathDrift {
  const applied = parsePlexPathSnapshot(input.appliedPaths)
  const observed = parsePlexPathSnapshot(input.observedPaths)
  const changedRatingKeys = new Set(findChangedPlexRatingKeys(applied, observed))
  return {
    changedRatingKeys,
    detected: input.enabled
      && !input.isAlbum
      && !input.dryRun
      && input.hasPlexPlaylist
      && Object.keys(applied).length > 0
      && changedRatingKeys.size > 0,
  }
}

export function resolveTrustedSongSnapshot(input: {
  source: PlaylistSource
  currentIdOrder: readonly number[]
  observedPlexPaths: string | null | undefined
  changedRatingKeys: ReadonlySet<string>
  forceFullVerification: boolean
}): Set<number> {
  const previous = parseOrderedSnapshot(input.source.observedNeteaseIds ?? input.source.trackIdSnapshot)
  const neteaseDiff = previous
    ? diffOrderedSnapshot(previous, input.currentIdOrder.map(String))
    : null

  const changedSongIds = new Set<number>()
  if (input.changedRatingKeys.size > 0) {
    for (const binding of getSongIdentityBindings([...input.currentIdOrder]).values()) {
      if (binding.plexRatingKey && input.changedRatingKeys.has(binding.plexRatingKey)) {
        changedSongIds.add(binding.neteaseSongId)
      }
    }
  }

  const trusted = !input.forceFullVerification
    && input.source.appliedPlexPaths
    && input.observedPlexPaths
    ? neteaseDiff
    : null
  const added = new Set(trusted?.added ?? [])
  return trusted
    ? new Set(input.currentIdOrder.filter(id => !added.has(String(id)) && !changedSongIds.has(id)))
    : new Set()
}
