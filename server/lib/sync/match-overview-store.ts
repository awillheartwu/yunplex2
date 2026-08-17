import { getDb } from '../db'
import { parseJsonOr } from '../json'
import type {
  MatchOverviewItem,
  MatchOverviewPage,
  MatchOverviewState,
  MatchOverviewTarget,
  PlaylistSourceTrackOccurrence,
} from '../../../types/match-management'
import type { SongIdentityBinding } from '../../../types/match-review'

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
    evidence: parseJsonOr(row.evidence_json, {}),
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
    evidence: parseJsonOr(row.evidence_json, {}),
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
    const desired = parseJsonOr<ReviewDesiredEvidence>(row.evidence_json, {}).desired
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

export function queryMatchOverviewReadModel(filters: {
  sourceId: string | 'orphaned'
  state?: MatchOverviewState
  search?: string
  includeRemoved?: boolean
  page?: number
  pageSize?: number
  listOccurrences: (sourceId: string, membership: 'current' | 'removed' | 'all') => PlaylistSourceTrackOccurrence[]
}): MatchOverviewPage {
  const db = getDb()
  const occurrences = filters.sourceId === 'orphaned'
    ? []
    : filters.listOccurrences(filters.sourceId, filters.includeRemoved ? 'all' : 'current')
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

