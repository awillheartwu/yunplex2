import type { NeteaseSong } from '../netease'

export type Resolution =
  | 'matched_plex_playlist'
  | 'found_in_plex_library'
  | 'found_on_disk'
  | 'needs_download'
  | 'unavailable'

export interface TrackResolution {
  neteaseIndex: number
  song: NeteaseSong
  resolution: Resolution
  plexRatingKey?: string
  playlistItemId?: number    // present when already in the Plex playlist
  filePath?: string           // present when found_on_disk
}

export interface SongLookupRow {
  netease_song_id: number
  plex_rating_key: string | null
  file_path: string | null
  last_verified_at: string
}
