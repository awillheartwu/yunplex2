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

/** Only settings that change this source's target or reconciliation behavior. */
export function sourceConvergenceSettingsKey(source: PlaylistSource, config: AppConfig): string {
  const settings = resolveEffectiveSourceSyncSettings(source, config)
  const skipPlaylist = source.type === 'album' && settings.skipPlexPlaylist
  return JSON.stringify([
    source.type, source.neteasePlaylistId,
    source.type === 'playlist' ? source.syncLimit ?? config.sync.songLimit : null,
    skipPlaylist,
    skipPlaylist ? null : source.plexPlaylistRatingKey || [source.plexPlaylistName || source.neteasePlaylistName, source.autoCreatePlexPlaylist],
    skipPlaylist ? null : settings.skipRemoveExtraTracks,
    skipPlaylist || settings.skipRemoveExtraTracks ? null : config.sync.extraTrackRemovalPolicy,
    config.sync.unverifiedMediaPolicy,
    config.plex.server, config.plex.port, config.plex.section,
    config.download.dir, config.download.plexLibraryPathPrefix,
  ])
}
