import { getDb } from '../db'
import { parseJsonOr } from '../json'
import { queryMatchOverviewReadModel } from './match-overview-store'
import type { NeteaseSong } from '../netease'
import { normalizePlexPath } from './identity-normalization'
import type {
  PlaylistSourceTrackOccurrence,
  TrackMembershipStatus,
} from '../../../types/match-management'
import type {
  MatchOverviewPage,
  MatchOverviewState,
} from '../../../types/match-management'

type OccurrenceRow = {
  id: string
  source_id: string
  netease_song_id: number
  occurrence: number
  position: number
  title: string
  artists_json: string
  album_id: number | null
  album_name: string
  cover_url: string
  track_number: number | null
  disc_number: number | null
  duration_ms: number | null
  metadata_complete: number
  membership_status: 'current' | 'removed'
  removal_reason: 'netease_removed' | 'sync_limit_excluded' | null
  last_song_status: string | null
  last_run_id: string | null
  match_trace_json: string | null
  last_error_json: string | null
  alignment_status: 'aligned' | 'pending' | 'missing' | 'unknown'
  aligned_plex_rating_key: string | null
  aligned_plex_relative_path: string | null
  aligned_binding_updated_at: string | null
  aligned_at: string | null
  first_observed_at: string
  last_observed_at: string
  removed_at: string | null
}

export interface ObservePlaylistSourceTracksInput {
  sourceId: string
  runId?: string | null
  managedSongs: NeteaseSong[]
  managedSongIds: number[]
  /** Complete authoritative membership, before applying syncLimit. */
  allSongIds: number[]
  observedAt?: string
}

export interface PlaylistAlignmentValidationInput {
  sourceId: string
  playlistItems: Array<{
    ratingKey: string
    plexFilePaths: string[]
  }>
  /** Omit to validate every current target occurrence in the source. */
  neteaseSongIds?: number[]
  observedAt?: string
}

export interface PlaylistAlignmentValidationResult {
  aligned: number
  pending: number
  missing: number
}

function mapOccurrence(row: OccurrenceRow): PlaylistSourceTrackOccurrence {
  return {
    id: row.id,
    sourceId: row.source_id,
    neteaseSongId: row.netease_song_id,
    occurrence: row.occurrence,
    position: row.position,
    title: row.title,
    artists: parseJsonOr<string[]>(row.artists_json, []),
    albumId: row.album_id,
    albumName: row.album_name,
    coverUrl: row.cover_url,
    trackNumber: row.track_number,
    discNumber: row.disc_number,
    durationMs: row.duration_ms,
    metadataComplete: row.metadata_complete === 1,
    membershipStatus: row.membership_status,
    removalReason: row.removal_reason,
    lastSongStatus: row.last_song_status,
    lastRunId: row.last_run_id,
    matchTrace: parseJsonOr<Record<string, unknown> | null>(row.match_trace_json, null),
    lastError: parseJsonOr<Record<string, unknown> | null>(row.last_error_json, null),
    alignmentStatus: row.alignment_status,
    alignedPlexRatingKey: row.aligned_plex_rating_key,
    alignedPlexRelativePath: row.aligned_plex_relative_path,
    alignedBindingUpdatedAt: row.aligned_binding_updated_at,
    alignedAt: row.aligned_at,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    removedAt: row.removed_at,
  }
}

function positiveInteger(value: string | number | null | undefined): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function occurrenceId(sourceId: string, songId: number, occurrence: number): string {
  return `${sourceId}:${songId}:${occurrence}`
}

export function observePlaylistSourceTracks(input: ObservePlaylistSourceTracksInput): void {
  const db = getDb()
  const observedAt = input.observedAt ?? new Date().toISOString()

  db.transaction(() => {
    const previousRows = db.prepare(`
      SELECT id, netease_song_id, occurrence, position, membership_status
      FROM playlist_source_track_occurrences
      WHERE source_id = ?
    `).all(input.sourceId) as Array<Pick<
      OccurrenceRow,
      'id' | 'netease_song_id' | 'occurrence' | 'position' | 'membership_status'
    >>
    const previousById = new Map(previousRows.map(row => [row.id, row]))

    const songsById = new Map<number, NeteaseSong[]>()
    for (const song of input.managedSongs) {
      const queue = songsById.get(song.id) ?? []
      queue.push(song)
      songsById.set(song.id, queue)
    }

    const managedCounts = new Map<number, number>()
    const activeIds = new Set<string>()
    let membershipChanged = false
    const upsert = db.prepare(`
      INSERT INTO playlist_source_track_occurrences (
        id, source_id, netease_song_id, occurrence, position,
        title, artists_json, album_id, album_name, cover_url,
        track_number, disc_number, duration_ms, metadata_complete,
        membership_status, removal_reason, last_run_id, alignment_status,
        first_observed_at, last_observed_at, removed_at
      ) VALUES (
        @id, @sourceId, @songId, @occurrence, @position,
        @title, @artistsJson, @albumId, @albumName, @coverUrl,
        @trackNumber, @discNumber, @durationMs, @metadataComplete,
        'current', NULL, @runId, 'pending',
        @observedAt, @observedAt, NULL
      )
      ON CONFLICT(source_id, netease_song_id, occurrence) DO UPDATE SET
        position = excluded.position,
        title = CASE WHEN excluded.metadata_complete = 1 THEN excluded.title ELSE title END,
        artists_json = CASE WHEN excluded.metadata_complete = 1 THEN excluded.artists_json ELSE artists_json END,
        album_id = CASE WHEN excluded.metadata_complete = 1 THEN excluded.album_id ELSE album_id END,
        album_name = CASE WHEN excluded.metadata_complete = 1 THEN excluded.album_name ELSE album_name END,
        cover_url = CASE WHEN excluded.metadata_complete = 1 THEN excluded.cover_url ELSE cover_url END,
        track_number = CASE WHEN excluded.metadata_complete = 1 THEN excluded.track_number ELSE track_number END,
        disc_number = CASE WHEN excluded.metadata_complete = 1 THEN excluded.disc_number ELSE disc_number END,
        duration_ms = CASE WHEN excluded.metadata_complete = 1 THEN excluded.duration_ms ELSE duration_ms END,
        metadata_complete = MAX(metadata_complete, excluded.metadata_complete),
        membership_status = 'current',
        removal_reason = NULL,
        last_run_id = COALESCE(excluded.last_run_id, last_run_id),
        alignment_status = CASE
          WHEN membership_status = 'removed' OR position != excluded.position THEN 'pending'
          ELSE alignment_status
        END,
        last_observed_at = excluded.last_observed_at,
        removed_at = NULL
    `)

    for (const [position, songId] of input.managedSongIds.entries()) {
      const occurrence = managedCounts.get(songId) ?? 0
      managedCounts.set(songId, occurrence + 1)
      const id = occurrenceId(input.sourceId, songId, occurrence)
      activeIds.add(id)
      const song = songsById.get(songId)?.shift()
      const previous = previousById.get(id)
      if (!previous || previous.membership_status !== 'current' || previous.position !== position) {
        membershipChanged = true
      }
      upsert.run({
        id,
        sourceId: input.sourceId,
        songId,
        occurrence,
        position,
        title: song?.name ?? '',
        artistsJson: JSON.stringify(song?.artists.map(artist => artist.name) ?? []),
        albumId: song?.album.id ?? null,
        albumName: song?.album.name ?? '',
        coverUrl: song?.album.picUrl ?? '',
        trackNumber: song?.no ?? null,
        discNumber: positiveInteger(song?.disc),
        durationMs: song?.dt ?? null,
        metadataComplete: song ? 1 : 0,
        runId: input.runId ?? null,
        observedAt,
      })
    }

    const allCounts = new Map<number, number>()
    for (const id of input.allSongIds) allCounts.set(id, (allCounts.get(id) ?? 0) + 1)
    const markRemoved = db.prepare(`
      UPDATE playlist_source_track_occurrences SET
        membership_status = 'removed',
        removal_reason = ?,
        alignment_status = 'pending',
        last_run_id = COALESCE(?, last_run_id),
        last_observed_at = ?,
        removed_at = COALESCE(removed_at, ?)
      WHERE id = ?
    `)
    for (const row of previousRows) {
      if (row.membership_status !== 'current' || activeIds.has(row.id)) continue
      const reason = row.occurrence < (allCounts.get(row.netease_song_id) ?? 0)
        ? 'sync_limit_excluded'
        : 'netease_removed'
      markRemoved.run(reason, input.runId ?? null, observedAt, observedAt, row.id)
      membershipChanged = true
    }

    if (membershipChanged) {
      db.prepare(`
        UPDATE playlist_sources
        SET requires_match_reconcile = 1, updated_at = ?
        WHERE id = ?
      `).run(observedAt, input.sourceId)
    }
  })()
}

export function listPlaylistSourceTrackOccurrences(
  sourceId: string,
  membership: TrackMembershipStatus | 'all' = 'current',
): PlaylistSourceTrackOccurrence[] {
  const where = membership === 'all' ? '' : 'AND membership_status = ?'
  const params = membership === 'all' ? [sourceId] : [sourceId, membership]
  const rows = getDb().prepare(`
    SELECT *
    FROM playlist_source_track_occurrences
    WHERE source_id = ? ${where}
    ORDER BY
      CASE membership_status WHEN 'current' THEN 0 ELSE 1 END,
      position ASC,
      occurrence ASC
  `).all(...params) as OccurrenceRow[]
  return rows.map(mapOccurrence)
}

export function recordPlaylistOccurrenceSyncResult(input: {
  sourceId: string
  position: number
  runId: string
  status: string
  matchTrace?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  observedAt?: string
}): void {
  const db = getDb()
  const observedAt = input.observedAt ?? new Date().toISOString()
  const row = db.prepare(`
    SELECT netease_song_id
    FROM playlist_source_track_occurrences
    WHERE source_id = ? AND membership_status = 'current' AND position = ?
  `).get(input.sourceId, input.position) as { netease_song_id: number } | undefined
  if (!row) return
  const binding = db.prepare(`
    SELECT plex_rating_key, plex_relative_path, updated_at
    FROM song_identity_bindings
    WHERE netease_song_id = ? AND status = 'active'
  `).get(row.netease_song_id) as {
    plex_rating_key: string | null
    plex_relative_path: string
    updated_at: string
  } | undefined
  const aligned = Boolean(binding && ['success', 'skipped_existing'].includes(input.status))
  const missing = ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(input.status)
  db.prepare(`
    UPDATE playlist_source_track_occurrences SET
      last_song_status = ?,
      last_run_id = ?,
      match_trace_json = ?,
      last_error_json = ?,
      alignment_status = ?,
      aligned_plex_rating_key = CASE WHEN ? THEN ? ELSE aligned_plex_rating_key END,
      aligned_plex_relative_path = CASE WHEN ? THEN ? ELSE aligned_plex_relative_path END,
      aligned_binding_updated_at = CASE WHEN ? THEN ? ELSE aligned_binding_updated_at END,
      aligned_at = CASE WHEN ? THEN ? ELSE aligned_at END,
      last_observed_at = ?
    WHERE source_id = ? AND membership_status = 'current' AND position = ?
  `).run(
    input.status,
    input.runId,
    input.matchTrace ? JSON.stringify(input.matchTrace) : null,
    input.error ? JSON.stringify(input.error) : null,
    aligned ? 'aligned' : missing ? 'missing' : 'pending',
    aligned ? 1 : 0,
    binding?.plex_rating_key ?? null,
    aligned ? 1 : 0,
    binding?.plex_relative_path ?? null,
    aligned ? 1 : 0,
    binding?.updated_at ?? null,
    aligned ? 1 : 0,
    observedAt,
    observedAt,
    input.sourceId,
    input.position,
  )
}

/**
 * Reconcile occurrence-level audit state against concrete items read from the
 * Plex playlist. A Plex occurrence is consumed at most once so duplicate target
 * songs require the same number of concrete playlist items.
 */
export function recordPlaylistAlignmentValidation(
  input: PlaylistAlignmentValidationInput,
): PlaylistAlignmentValidationResult {
  const db = getDb()
  const requestedSongIds = [...new Set(
    (input.neteaseSongIds ?? []).filter(id => Number.isSafeInteger(id) && id > 0),
  )]
  const requestedWhere = requestedSongIds.length
    ? `AND occurrence.netease_song_id IN (${requestedSongIds.map(() => '?').join(',')})`
    : ''
  const rows = db.prepare(`
    SELECT
      occurrence.id,
      binding.plex_file_path,
      binding.plex_relative_path,
      binding.plex_rating_key,
      binding.updated_at,
      binding.status
    FROM playlist_source_track_occurrences occurrence
    LEFT JOIN song_identity_bindings binding
      ON binding.netease_song_id = occurrence.netease_song_id
    WHERE occurrence.source_id = ?
      AND occurrence.membership_status = 'current'
      ${requestedWhere}
    ORDER BY occurrence.position ASC, occurrence.occurrence ASC
  `).all(input.sourceId, ...requestedSongIds) as Array<{
    id: string
    plex_file_path: string | null
    plex_relative_path: string | null
    plex_rating_key: string | null
    updated_at: string | null
    status: string | null
  }>
  const playlistItems = input.playlistItems.map(item => ({
    ratingKey: item.ratingKey,
    plexFilePaths: new Set(item.plexFilePaths.map(normalizePlexPath)),
  }))
  const consumed = new Set<number>()
  const observedAt = input.observedAt ?? new Date().toISOString()

  return db.transaction(() => {
    const result: PlaylistAlignmentValidationResult = { aligned: 0, pending: 0, missing: 0 }
    const markAligned = db.prepare(`
      UPDATE playlist_source_track_occurrences SET
        alignment_status = 'aligned',
        aligned_plex_rating_key = ?,
        aligned_plex_relative_path = ?,
        aligned_binding_updated_at = ?,
        aligned_at = ?,
        last_observed_at = ?
      WHERE id = ?
    `)
    const markUnaligned = db.prepare(`
      UPDATE playlist_source_track_occurrences SET
        alignment_status = ?,
        last_observed_at = ?
      WHERE id = ?
    `)

    for (const row of rows) {
      if (
        row.status !== 'active'
        || !row.plex_file_path
        || !row.plex_relative_path
        || !row.updated_at
      ) {
        markUnaligned.run('missing', observedAt, row.id)
        result.missing++
        continue
      }
      const bindingPath = normalizePlexPath(row.plex_file_path)
      const itemIndex = playlistItems.findIndex((item, index) =>
        !consumed.has(index)
        && (
          Boolean(row.plex_rating_key && item.ratingKey === row.plex_rating_key)
          || item.plexFilePaths.has(bindingPath)
        ),
      )
      if (itemIndex < 0) {
        markUnaligned.run('pending', observedAt, row.id)
        result.pending++
        continue
      }
      consumed.add(itemIndex)
      const item = playlistItems[itemIndex]!
      markAligned.run(
        item.ratingKey,
        row.plex_relative_path,
        row.updated_at,
        observedAt,
        observedAt,
        row.id,
      )
      result.aligned++
    }

    const remaining = db.prepare(`
      SELECT COUNT(*) AS count
      FROM playlist_source_track_occurrences
      WHERE source_id = ?
        AND membership_status = 'current'
        AND alignment_status != 'aligned'
    `).get(input.sourceId) as { count: number }
    db.prepare(`
      UPDATE playlist_sources
      SET requires_match_reconcile = ?
      WHERE id = ?
    `).run(remaining.count > 0 ? 1 : 0, input.sourceId)
    return result
  })()
}

export function queryMatchOverview(filters: {
  sourceId: string | 'orphaned'
  origin?: 'scored'
  state?: MatchOverviewState | 'needs_action' | 'problem'
  search?: string
  includeRemoved?: boolean
  page?: number
  pageSize?: number
}): MatchOverviewPage {
  return queryMatchOverviewReadModel({ ...filters, listOccurrences: listPlaylistSourceTrackOccurrences })
}

export function markSongSourcesPendingAlignment(neteaseSongId: number, observedAt = new Date().toISOString()): Array<{ id: string; name: string }> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT source.id, source.name, source.netease_playlist_name
    FROM playlist_source_track_occurrences occurrence
    JOIN playlist_sources source ON source.id = occurrence.source_id
    WHERE occurrence.netease_song_id = ? AND occurrence.membership_status = 'current'
    ORDER BY source.sort_order, source.name
  `).all(neteaseSongId) as Array<{ id: string; name: string; netease_playlist_name: string }>
  if (rows.length) {
    db.prepare(`
      UPDATE playlist_sources
      SET requires_match_reconcile = 1, updated_at = ?
      WHERE id IN (
        SELECT source_id FROM playlist_source_track_occurrences
        WHERE netease_song_id = ? AND membership_status = 'current'
      )
    `).run(observedAt, neteaseSongId)
    db.prepare(`
      UPDATE playlist_source_track_occurrences
      SET alignment_status = 'pending', last_observed_at = ?
      WHERE netease_song_id = ? AND membership_status = 'current'
    `).run(observedAt, neteaseSongId)
  }
  return rows.map(row => ({ id: row.id, name: row.name || row.netease_playlist_name || row.id }))
}
