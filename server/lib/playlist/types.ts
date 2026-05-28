export interface PlaylistSource {
  id: string
  neteasePlaylistId: number
  name: string
  neteasePlaylistName: string
  enabled: boolean
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
  forceFullCompare: boolean
  consecutiveSkips: number
  fullCompareAfterSkips: number | null
  fullCompareAfterDays: number | null
  lastFullCompareAt: string | null
  plexUpdatedAt: number | null
  trackIdSnapshot: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PlaylistSourceRow {
  id: string
  netease_playlist_id: number
  name: string
  netease_playlist_name: string
  enabled: number
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
  force_full_compare: number
  consecutive_skips: number
  full_compare_after_skips: number | null
  full_compare_after_days: number | null
  last_full_compare_at: string | null
  plex_updated_at: number | null
  track_id_snapshot: string | null
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
    enabled: row.enabled === 1,
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
    forceFullCompare: row.force_full_compare === 1,
    consecutiveSkips: row.consecutive_skips,
    fullCompareAfterSkips: row.full_compare_after_skips,
    fullCompareAfterDays: row.full_compare_after_days,
    lastFullCompareAt: row.last_full_compare_at,
    plexUpdatedAt: row.plex_updated_at,
    trackIdSnapshot: row.track_id_snapshot,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
