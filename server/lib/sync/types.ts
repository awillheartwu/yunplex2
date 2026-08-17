import type { NeteaseSong } from '../netease'
import type { MissingMediaDisposition } from './missing-media-policy'

export type Resolution =
  | 'matched_plex_playlist'
  | 'found_in_plex_library'
  | 'found_on_disk'
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
  mediaPolicy?: {
    disposition: MissingMediaDisposition
    audioPath?: string
    protectedAudioPath?: string
  }
  matchTrace?: MatchTrace
}

export type MatchTraceSource =
  | 'playlist'
  | 'plex_search'
  | 'disk'
  | 'invalid_local_file'
  | 'download_required'
  | 'dedupe_conflict'
  | 'identity_conflict'
  | 'identity_binding'
  | 'media_policy'

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
    method: 'path' | 'manual'
    plexFilePath: string
    bindingStatus?: 'active' | 'stale' | 'unbound'
  }
  /** Structured, source-specific proof retained for run-detail auditability. */
  evidence?: Record<string, unknown>
  decision?: 'bound' | 'preserved' | 'removed'
  deletionProtectionReason?: string
}
