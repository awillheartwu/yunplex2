import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { NeteaseSong } from '../netease'
import { normalizePlexPath } from './identity-normalization'
import type {
  PlaylistSourceTrackOccurrence,
  SongIdentityEvent,
  SongIdentityEventType,
  TrackMembershipStatus,
} from '../../../types/match-management'
import type { SongIdentityBinding } from '../../../types/match-review'
import type {
  MatchOverviewItem,
  MatchOverviewPage,
  MatchOverviewState,
  MatchOverviewTarget,
  SongIdentityEventPage,
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

type IdentityEventRow = {
  id: string
  netease_song_id: number
  event_type: SongIdentityEventType
  actor_type: 'system' | 'admin'
  source_id: string | null
  run_id: string | null
  review_id: string | null
  previous_binding_json: string | null
  next_binding_json: string | null
  evidence_json: string
  created_at: string
}

export interface AppendSongIdentityEventInput {
  neteaseSongId: number
  eventType: SongIdentityEventType
  actorType: 'system' | 'admin'
  sourceId?: string | null
  runId?: string | null
  reviewId?: string | null
  previousBinding?: SongIdentityBinding | null
  nextBinding?: SongIdentityBinding | null
  evidence?: Record<string, unknown>
  createdAt?: string
}

function mapIdentityEvent(row: IdentityEventRow): SongIdentityEvent {
  return {
    id: row.id,
    neteaseSongId: row.netease_song_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    sourceId: row.source_id,
    runId: row.run_id,
    reviewId: row.review_id,
    previousBinding: safeJson<SongIdentityBinding | null>(row.previous_binding_json, null),
    nextBinding: safeJson<SongIdentityBinding | null>(row.next_binding_json, null),
    evidence: safeJson<Record<string, unknown>>(row.evidence_json, {}),
    createdAt: row.created_at,
  }
}

export function appendSongIdentityEvent(input: AppendSongIdentityEventInput): SongIdentityEvent {
  const id = randomUUID()
  const createdAt = input.createdAt ?? new Date().toISOString()
  getDb().prepare(`
    INSERT INTO song_identity_events (
      id, netease_song_id, event_type, actor_type, source_id, run_id, review_id,
      previous_binding_json, next_binding_json, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.neteaseSongId,
    input.eventType,
    input.actorType,
    input.sourceId ?? null,
    input.runId ?? null,
    input.reviewId ?? null,
    input.previousBinding ? JSON.stringify(input.previousBinding) : null,
    input.nextBinding ? JSON.stringify(input.nextBinding) : null,
    JSON.stringify(input.evidence ?? {}),
    createdAt,
  )
  const row = getDb().prepare('SELECT * FROM song_identity_events WHERE id = ?').get(id) as IdentityEventRow
  return mapIdentityEvent(row)
}

export function listSongIdentityEvents(filters: {
  neteaseSongId?: number
  sourceId?: string
  actorType?: 'system' | 'admin'
  eventType?: SongIdentityEventType
  from?: string
  to?: string
  limit?: number
  offset?: number
}): SongIdentityEvent[] {
  const conditions: string[] = []
  const values: unknown[] = []
  if (filters.neteaseSongId !== undefined) {
    conditions.push('netease_song_id = ?')
    values.push(filters.neteaseSongId)
  }
  if (filters.sourceId) {
    conditions.push('source_id = ?')
    values.push(filters.sourceId)
  }
  if (filters.actorType) {
    conditions.push('actor_type = ?')
    values.push(filters.actorType)
  }
  if (filters.eventType) {
    conditions.push('event_type = ?')
    values.push(filters.eventType)
  }
  if (filters.from) {
    conditions.push('created_at >= ?')
    values.push(filters.from)
  }
  if (filters.to) {
    conditions.push('created_at <= ?')
    values.push(filters.to)
  }
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 500)
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = getDb().prepare(`
    SELECT * FROM song_identity_events
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as IdentityEventRow[]
  return rows.map(mapIdentityEvent)
}

export function querySongIdentityEvents(filters: Parameters<typeof listSongIdentityEvents>[0] & {
  page?: number
  pageSize?: number
}): SongIdentityEventPage {
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25), 1), 100)
  const requestedPage = Math.max(Math.trunc(filters.page ?? 1), 1)
  const conditions: string[] = []
  const values: unknown[] = []
  if (filters.neteaseSongId !== undefined) {
    conditions.push('netease_song_id = ?')
    values.push(filters.neteaseSongId)
  }
  if (filters.sourceId) {
    conditions.push('source_id = ?')
    values.push(filters.sourceId)
  }
  if (filters.actorType) {
    conditions.push('actor_type = ?')
    values.push(filters.actorType)
  }
  if (filters.eventType) {
    conditions.push('event_type = ?')
    values.push(filters.eventType)
  }
  if (filters.from) {
    conditions.push('created_at >= ?')
    values.push(filters.from)
  }
  if (filters.to) {
    conditions.push('created_at <= ?')
    values.push(filters.to)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = (getDb().prepare(`SELECT COUNT(*) AS count FROM song_identity_events ${where}`)
    .get(...values) as { count: number }).count
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const page = Math.min(requestedPage, totalPages)
  return {
    items: listSongIdentityEvents({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
    total,
    page,
    pageSize,
  }
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapOccurrence(row: OccurrenceRow): PlaylistSourceTrackOccurrence {
  return {
    id: row.id,
    sourceId: row.source_id,
    neteaseSongId: row.netease_song_id,
    occurrence: row.occurrence,
    position: row.position,
    title: row.title,
    artists: safeJson<string[]>(row.artists_json, []),
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
    matchTrace: safeJson<Record<string, unknown> | null>(row.match_trace_json, null),
    lastError: safeJson<Record<string, unknown> | null>(row.last_error_json, null),
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

type OverviewBindingRow = {
  netease_song_id: number
  plex_section_key: string
  plex_file_path: string
  plex_relative_path: string
  plex_rating_key: string | null
  mb_recording_id: string | null
  binding_method: SongIdentityBinding['bindingMethod']
  status: SongIdentityBinding['status']
  evidence_json: string
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

type OverviewLocalMediaRow = {
  netease_song_id: number
  file_path: string
  ownership: 'managed' | 'external'
  provenance: 'download_task' | 'legacy_download_task' | 'computed' | 'manual'
  status: 'active' | 'missing' | 'replaced'
  evidence_json: string
  last_verified_at: string | null
}

function mapOverviewLocalMedia(row: OverviewLocalMediaRow): MatchOverviewItem['localMedia'] {
  return {
    filePath: row.file_path,
    ownership: row.ownership,
    provenance: row.provenance,
    status: row.status,
    evidence: safeJson(row.evidence_json, {}),
    lastVerifiedAt: row.last_verified_at,
  }
}

function mapOverviewBinding(row: OverviewBindingRow): SongIdentityBinding {
  return {
    neteaseSongId: row.netease_song_id,
    plexSectionKey: row.plex_section_key,
    plexFilePath: row.plex_file_path,
    plexRelativePath: row.plex_relative_path,
    plexRatingKey: row.plex_rating_key,
    mbRecordingId: row.mb_recording_id,
    bindingMethod: row.binding_method,
    status: row.status,
    evidence: safeJson(row.evidence_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function overviewState(
  occurrence: PlaylistSourceTrackOccurrence | null,
  binding: SongIdentityBinding | null,
  pendingReviewCount: number,
): MatchOverviewState {
  if (occurrence?.membershipStatus === 'removed') return 'removed'
  if (binding?.status === 'stale') return 'binding_stale'
  if (pendingReviewCount > 0) return 'pending_review'
  if (!binding || binding.status !== 'active') {
    if (occurrence?.lastSongStatus === 'copyright_restricted') return 'copyright_restricted'
    if (occurrence?.lastSongStatus === 'ignored_failure') return 'retry_paused'
    if (occurrence?.alignmentStatus === 'missing') return 'sync_failed'
    return 'unmatched'
  }
  if (occurrence?.alignmentStatus === 'unknown') return 'historical_unverified'
  if (
    occurrence?.alignmentStatus === 'aligned'
    && occurrence.alignedBindingUpdatedAt === binding.updatedAt
  ) return 'matched'
  return 'pending_alignment'
}

type ReviewTargetRow = {
  netease_song_id: number
  source_id: string | null
  evidence_json: string
}

type ReviewDesiredEvidence = {
  desired?: {
    title?: unknown
    artists?: unknown
    album?: unknown
  }
}

function reviewEvidenceTargets(
  songIds: number[],
  preferredSourceId: string | null,
): Map<number, Omit<MatchOverviewTarget, 'neteaseSongId' | 'coverUrl' | 'metadataSource'>> {
  const result = new Map<number, {
    title: string
    artists: string[]
    albumName: string
    preferred: boolean
  }>()
  if (!songIds.length) return result

  const rows = getDb().prepare(`
    SELECT netease_song_id, source_id, evidence_json
    FROM song_match_reviews
    WHERE netease_song_id IN (${songIds.map(() => '?').join(',')})
    ORDER BY created_at DESC, id DESC
  `).all(...songIds) as ReviewTargetRow[]

  for (const row of rows) {
    const desired = safeJson<ReviewDesiredEvidence>(row.evidence_json, {}).desired
    if (!desired) continue
    const title = typeof desired.title === 'string' ? desired.title.trim() : ''
    const artists = Array.isArray(desired.artists)
      ? desired.artists.filter((artist): artist is string => typeof artist === 'string' && Boolean(artist.trim()))
      : []
    const albumName = typeof desired.album === 'string' ? desired.album.trim() : ''
    if (!title && !artists.length && !albumName) continue

    const preferred = Boolean(preferredSourceId && row.source_id === preferredSourceId)
    const existing = result.get(row.netease_song_id)
    if (existing && (existing.preferred || !preferred)) continue
    result.set(row.netease_song_id, { title, artists, albumName, preferred })
  }

  return new Map([...result].map(([songId, value]) => [
    songId,
    { title: value.title, artists: value.artists, albumName: value.albumName },
  ]))
}

function buildOverviewTarget(
  neteaseSongId: number,
  occurrence: PlaylistSourceTrackOccurrence | null,
  reviewTarget: { title: string; artists: string[]; albumName: string } | undefined,
): MatchOverviewTarget {
  const title = occurrence?.title || reviewTarget?.title || ''
  const artists = occurrence?.artists.length ? occurrence.artists : reviewTarget?.artists ?? []
  const albumName = occurrence?.albumName || reviewTarget?.albumName || ''
  const usedReviewEvidence = Boolean(
    reviewTarget
    && (
      (!occurrence?.title && reviewTarget.title)
      || (!occurrence?.artists.length && reviewTarget.artists.length)
      || (!occurrence?.albumName && reviewTarget.albumName)
    ),
  )
  return {
    neteaseSongId,
    title,
    artists,
    albumName,
    coverUrl: occurrence?.coverUrl || '',
    metadataSource: usedReviewEvidence
      ? 'review_evidence'
      : title || artists.length || albumName ? 'occurrence' : 'unknown',
  }
}

export function queryMatchOverview(filters: {
  sourceId: string | 'orphaned'
  state?: MatchOverviewState
  search?: string
  includeRemoved?: boolean
  page?: number
  pageSize?: number
}): MatchOverviewPage {
  const db = getDb()
  const occurrences = filters.sourceId === 'orphaned'
    ? []
    : listPlaylistSourceTrackOccurrences(filters.sourceId, filters.includeRemoved ? 'all' : 'current')
  const orphanRows = filters.sourceId === 'orphaned'
    ? db.prepare(`
        SELECT binding.*
        FROM song_identity_bindings binding
        WHERE NOT EXISTS (
          SELECT 1 FROM playlist_source_track_occurrences occurrence
          WHERE occurrence.netease_song_id = binding.netease_song_id
            AND occurrence.membership_status = 'current'
        )
        ORDER BY binding.updated_at DESC, binding.netease_song_id ASC
      `).all() as OverviewBindingRow[]
    : []
  const songIds = filters.sourceId === 'orphaned'
    ? orphanRows.map(row => row.netease_song_id)
    : [...new Set(occurrences.map(item => item.neteaseSongId))]
  const bindingRows = songIds.length
    ? db.prepare(`
        SELECT * FROM song_identity_bindings
        WHERE netease_song_id IN (${songIds.map(() => '?').join(',')})
      `).all(...songIds) as OverviewBindingRow[]
    : []
  const bindings = new Map(bindingRows.map(row => [row.netease_song_id, mapOverviewBinding(row)]))
  for (const row of orphanRows) bindings.set(row.netease_song_id, mapOverviewBinding(row))
  const localMediaRows = songIds.length
    ? db.prepare(`
        SELECT netease_song_id, file_path, ownership, provenance, status, evidence_json, last_verified_at
        FROM local_media_assets
        WHERE netease_song_id IN (${songIds.map(() => '?').join(',')})
      `).all(...songIds) as OverviewLocalMediaRow[]
    : []
  const localMedia = new Map(localMediaRows.map(row => [row.netease_song_id, mapOverviewLocalMedia(row)]))
  const reviewTargets = reviewEvidenceTargets(
    songIds,
    filters.sourceId === 'orphaned' ? null : filters.sourceId,
  )

  const reviewCounts = new Map<number, number>()
  if (songIds.length) {
    const rows = db.prepare(`
      SELECT netease_song_id, COUNT(*) AS count
      FROM song_match_reviews
      WHERE status = 'pending' AND netease_song_id IN (${songIds.map(() => '?').join(',')})
      GROUP BY netease_song_id
    `).all(...songIds) as Array<{ netease_song_id: number; count: number }>
    for (const row of rows) reviewCounts.set(row.netease_song_id, row.count)
  }
  const affectedRows = songIds.length
    ? db.prepare(`
        SELECT DISTINCT occurrence.netease_song_id, source.id, source.name, source.netease_playlist_name
        FROM playlist_source_track_occurrences occurrence
        JOIN playlist_sources source ON source.id = occurrence.source_id
        WHERE occurrence.membership_status = 'current'
          AND occurrence.netease_song_id IN (${songIds.map(() => '?').join(',')})
        ORDER BY source.sort_order, source.name
      `).all(...songIds) as Array<{
        netease_song_id: number
        id: string
        name: string
        netease_playlist_name: string
      }>
    : []
  const affected = new Map<number, Array<{ id: string; name: string }>>()
  for (const row of affectedRows) {
    const values = affected.get(row.netease_song_id) ?? []
    values.push({ id: row.id, name: row.name || row.netease_playlist_name || row.id })
    affected.set(row.netease_song_id, values)
  }

  const candidates: MatchOverviewItem[] = filters.sourceId === 'orphaned'
    ? orphanRows.map(row => {
        const binding = bindings.get(row.netease_song_id) ?? null
        return {
          target: buildOverviewTarget(row.netease_song_id, null, reviewTargets.get(row.netease_song_id)),
          occurrence: null,
          binding,
          localMedia: localMedia.get(row.netease_song_id) ?? null,
          state: overviewState(null, binding, reviewCounts.get(row.netease_song_id) ?? 0),
          pendingReviewCount: reviewCounts.get(row.netease_song_id) ?? 0,
          affectedSources: [],
        }
      })
    : occurrences.map(occurrence => {
        const binding = bindings.get(occurrence.neteaseSongId) ?? null
        const pendingReviewCount = reviewCounts.get(occurrence.neteaseSongId) ?? 0
        return {
          target: buildOverviewTarget(
            occurrence.neteaseSongId,
            occurrence,
            reviewTargets.get(occurrence.neteaseSongId),
          ),
          occurrence,
          binding,
          localMedia: localMedia.get(occurrence.neteaseSongId) ?? null,
          state: overviewState(occurrence, binding, pendingReviewCount),
          pendingReviewCount,
          affectedSources: affected.get(occurrence.neteaseSongId) ?? [],
        }
      })
  const query = filters.search?.trim().toLocaleLowerCase()
  const filtered = candidates.filter(item => {
    if (filters.state && item.state !== filters.state) return false
    if (!query) return true
    return [
      item.target.title,
      item.target.artists.join(' '),
      item.target.albumName,
      String(item.target.neteaseSongId),
      item.binding?.plexRelativePath,
      item.localMedia?.filePath,
    ].some(value => value?.toLocaleLowerCase().includes(query))
  })
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 50), 1), 100)
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1)
  const page = Math.min(Math.max(Math.trunc(filters.page ?? 1), 1), totalPages)
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    staleAfterMinutes: 10,
  }
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
