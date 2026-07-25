import type { NeteaseSong } from '../netease'

export type Resolution =
  | 'matched_plex_playlist'
  | 'found_in_plex_library'
  | 'found_on_disk'
  | 'needs_review'
  | 'needs_download'
  | 'copyright_restricted'
  | 'ignored_failure'
  | 'unavailable'

export interface TrackResolution {
  neteaseIndex: number
  song: NeteaseSong
  resolution: Resolution
  plexRatingKey?: string
  playlistItemId?: number    // present when already in the Plex playlist
  filePath?: string           // present when found_on_disk
  matchTrace?: MatchTrace
}

export type MatchTraceSource =
  | 'playlist'
  | 'lookup_cache'
  | 'plex_search'
  | 'disk'
  | 'invalid_local_file'
  | 'download_required'
  | 'dedupe_conflict'
  | 'identity_binding'
  | 'legacy_binding_migrated'
  | 'pending_review'
  | 'mb_recording_migration'
  | 'high_confidence_metadata'
  | 'provider_identity'

export interface MatchTrace {
  source: MatchTraceSource
  ratingKey?: string
  filePath?: string
  titleMatched?: boolean
  artistMatched?: boolean
  albumMatched?: boolean
  cacheVerified?: boolean
  conflictReason?: string
  message?: string
  identity?: {
    method: 'path' | 'mb_recording' | 'metadata' | 'manual' | 'migrated'
    plexFilePath: string
    mbRecordingId?: string | null
    bindingStatus?: 'active' | 'stale' | 'unbound'
  }
  candidate?: {
    plexFilePath?: string | null
    ratingKey?: string | null
    mbRecordingId?: string | null
    reviewId?: string
  }
  /** Structured, source-specific proof retained for run-detail auditability. */
  evidence?: Record<string, unknown>
  decision?: 'bound' | 'migrated' | 'pending_review' | 'preserved' | 'removed'
  deletionProtectionReason?: string
}

export interface SongLookupRow {
  netease_song_id: number
  plex_rating_key: string | null
  file_path: string | null
  last_verified_at: string
}
