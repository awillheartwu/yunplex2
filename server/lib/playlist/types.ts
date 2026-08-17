export type SourceType = 'playlist' | 'album'

export interface PlaylistSource {
  id: string
  neteasePlaylistId: number
  name: string
  neteasePlaylistName: string
  type: SourceType
  subscribed: boolean
  enabled: boolean
  coverUrl: string
  plexPlaylistName: string
  plexPlaylistRatingKey: string
  syncLimit: number | null
  lastSyncedAt: string | null
  lastStatus: 'idle' | 'success' | 'partial' | 'failed'
  lastError: string | null
  lastJobId: string | null
  autoCreatePlexPlaylist: boolean
  trackCount: number
  lastTrackUpdateTime: number | null
  forceFullCompare: boolean | null
  downloadWhenMediaMissing: boolean | null
  consecutiveSkips: number
  fullCompareAfterSkips: number | null
  fullCompareAfterDays: number | null
  lastFullCompareAt: string | null
  plexUpdatedAt: number | null
  trackIdSnapshot: string | null
  /** Latest Plex contents fetched, whether or not the run converged. */
  lastObservedPlexFingerprint: string | null
  /** Plex contents read back after the application's own successful mutation. */
  lastAppliedPlexFingerprint: string | null
  /** Latest NetEase snapshot fetched, including partial/failed reconciliation runs. */
  lastObservedNeteaseCursor: string | null
  /** Latest NetEase snapshot that completed identity comparison. Not a convergence marker. */
  lastComparedNeteaseCursor: string | null
  lastObservedAt: string | null
  lastComparedAt: string | null
  skipPlexPlaylist: boolean | null
  skipRemoveExtraTracks: boolean | null
  copyrightRestrictedIds: string | null
  ignoredFailureIds: string | null
  requiresMatchReconcile: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PlaylistSourceRow {
  id: string
  netease_playlist_id: number
  name: string
  netease_playlist_name: string
  type: string
  subscribed: number
  enabled: number
  cover_url: string
  plex_playlist_name: string
  plex_playlist_rating_key: string
  sync_limit: number | null
  last_synced_at: string | null
  last_status: string
  last_error: string | null
  last_job_id: string | null
  auto_create_plex_playlist: number
  track_count: number
  last_track_update_time: number | null
  force_full_compare: number | null
  download_when_media_missing: number | null
  consecutive_skips: number
  full_compare_after_skips: number | null
  full_compare_after_days: number | null
  last_full_compare_at: string | null
  plex_updated_at: number | null
  track_id_snapshot: string | null
  last_observed_plex_fingerprint: string | null
  last_applied_plex_fingerprint: string | null
  last_observed_netease_cursor: string | null
  last_compared_netease_cursor: string | null
  last_observed_at: string | null
  last_compared_at: string | null
  skip_plex_playlist: number | null
  skip_remove_extra_tracks: number | null
  copyright_restricted_ids: string | null
  ignored_failure_ids: string | null
  requires_match_reconcile: number
  sort_order: number
  created_at: string
  updated_at: string
}

export function rowToSource(row: PlaylistSourceRow): PlaylistSource {
  return {
    id: row.id,
    neteasePlaylistId: row.netease_playlist_id,
    name: row.name,
    neteasePlaylistName: row.netease_playlist_name,
    type: row.type as SourceType,
    subscribed: row.subscribed === 1,
    enabled: row.enabled === 1,
    coverUrl: row.cover_url ?? '',
    plexPlaylistName: row.plex_playlist_name,
    plexPlaylistRatingKey: row.plex_playlist_rating_key,
    syncLimit: row.sync_limit,
    lastSyncedAt: row.last_synced_at,
    lastStatus: row.last_status as PlaylistSource['lastStatus'],
    lastError: row.last_error,
    lastJobId: row.last_job_id,
    autoCreatePlexPlaylist: row.auto_create_plex_playlist === 1,
    trackCount: row.track_count,
    lastTrackUpdateTime: row.last_track_update_time,
    forceFullCompare: row.force_full_compare === null ? null : row.force_full_compare === 1,
    downloadWhenMediaMissing: row.download_when_media_missing === null ? null : row.download_when_media_missing === 1,
    consecutiveSkips: row.consecutive_skips,
    fullCompareAfterSkips: row.full_compare_after_skips,
    fullCompareAfterDays: row.full_compare_after_days,
    lastFullCompareAt: row.last_full_compare_at,
    plexUpdatedAt: row.plex_updated_at,
    trackIdSnapshot: row.track_id_snapshot,
    lastObservedPlexFingerprint: row.last_observed_plex_fingerprint,
    lastAppliedPlexFingerprint: row.last_applied_plex_fingerprint,
    lastObservedNeteaseCursor: row.last_observed_netease_cursor,
    lastComparedNeteaseCursor: row.last_compared_netease_cursor,
    lastObservedAt: row.last_observed_at,
    lastComparedAt: row.last_compared_at,
    skipPlexPlaylist: row.skip_plex_playlist === null ? null : row.skip_plex_playlist === 1,
    skipRemoveExtraTracks: row.skip_remove_extra_tracks === null ? null : row.skip_remove_extra_tracks === 1,
    copyrightRestrictedIds: row.copyright_restricted_ids,
    ignoredFailureIds: row.ignored_failure_ids,
    requiresMatchReconcile: row.requires_match_reconcile === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
