import { describe, expect, it } from 'vitest'
import { rowToSource, type PlaylistSourceRow } from './types'

describe('playlist source row mapping', () => {
  it('maps cover url from db rows', () => {
    const row: PlaylistSourceRow = {
      id: 'src-1',
      netease_playlist_id: 123,
      name: '任务',
      netease_playlist_name: '歌单',
      type: 'playlist',
      subscribed: 0,
      enabled: 1,
      cover_url: 'https://example.com/cover.jpg',
      plex_playlist_name: 'Plex',
      plex_playlist_rating_key: '',
      sync_limit: null,
      last_synced_at: null,
      last_status: 'idle',
      last_error: null,
      last_job_id: null,
      auto_create_plex_playlist: 1,
      track_count: 12,
      last_track_update_time: null,
      force_full_compare: 0,
      download_when_media_missing: null,
      consecutive_skips: 0,
      full_compare_after_skips: null,
      full_compare_after_days: null,
      last_full_compare_at: null,
      plex_updated_at: null,
      track_id_snapshot: null,
      last_observed_plex_fingerprint: null,
      last_applied_plex_fingerprint: null,
      last_observed_netease_cursor: null,
      last_compared_netease_cursor: null,
      last_observed_at: null,
      last_compared_at: null,
      skip_plex_playlist: 0,
      skip_remove_extra_tracks: 0,
      copyright_restricted_ids: null,
      ignored_failure_ids: null,
      requires_match_reconcile: 0,
      sort_order: 0,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }

    expect(rowToSource(row)).toMatchObject({
      coverUrl: 'https://example.com/cover.jpg',
      downloadWhenMediaMissing: null,
    })
  })
})
