import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'

export interface EffectiveSourceSyncSettings {
  forceFullCompare: boolean
  downloadWhenMediaMissing: boolean
  skipPlexPlaylist: boolean
  skipRemoveExtraTracks: boolean
  fullCompareAfterSkips: number
  fullCompareAfterDays: number
}

export function resolveEffectiveSourceSyncSettings(
  source: PlaylistSource,
  config: AppConfig,
): EffectiveSourceSyncSettings {
  return {
    forceFullCompare: source.forceFullCompare ?? config.sync.forceFullCompare,
    downloadWhenMediaMissing: source.downloadWhenMediaMissing ?? config.sync.downloadWhenMediaMissing,
    skipPlexPlaylist: source.skipPlexPlaylist ?? config.sync.skipPlexPlaylist,
    skipRemoveExtraTracks: source.skipRemoveExtraTracks ?? config.sync.skipRemoveExtraTracks,
    fullCompareAfterSkips: source.fullCompareAfterSkips ?? config.sync.fullCompareAfterSkips,
    fullCompareAfterDays: source.fullCompareAfterDays ?? config.sync.fullCompareAfterDays,
  }
}

export function enablesMissingMediaPolicy(
  previousOverride: boolean | null,
  nextOverride: boolean | null | undefined,
  globalValue: boolean,
): boolean {
  if (nextOverride === undefined) return false
  return !(previousOverride ?? globalValue) && (nextOverride ?? globalValue)
}
