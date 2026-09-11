import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'

export interface EffectiveSourceSyncSettings {
  forceFullCompare: boolean
  skipPlexPlaylist: boolean
  skipRemoveExtraTracks: boolean
  fullCompareAfterSkips: number
  fullCompareAfterDays: number
  initializeMediaOnFirstSync: boolean
}

export function resolveEffectiveSourceSyncSettings(
  source: PlaylistSource,
  config: AppConfig,
): EffectiveSourceSyncSettings {
  return {
    forceFullCompare: source.forceFullCompare ?? config.sync.forceFullCompare,
    skipPlexPlaylist: source.skipPlexPlaylist ?? config.sync.skipPlexPlaylist,
    skipRemoveExtraTracks: source.skipRemoveExtraTracks ?? config.sync.skipRemoveExtraTracks,
    fullCompareAfterSkips: source.fullCompareAfterSkips ?? config.sync.fullCompareAfterSkips,
    fullCompareAfterDays: source.fullCompareAfterDays ?? config.sync.fullCompareAfterDays,
    initializeMediaOnFirstSync: source.initializeMediaOnFirstSync ?? config.sync.initializeMediaOnFirstSync ?? true,
  }
}
