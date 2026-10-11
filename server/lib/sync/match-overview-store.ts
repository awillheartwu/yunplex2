import { mediaGroups, filterMembers } from '../../../shared/review-filter-groups'
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
import { projectMatchOverviewState } from '../../../lib/media-status-projection'

type OverviewBindingRow = {
  netease_song_id: number
  plex_section_key: string
  plex_file_path: string
  plex_relative_path: string
  plex_rating_key: string | null
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
): MatchOverviewState {
  if (occurrence?.membershipStatus === 'removed') return 'removed'
  if (binding?.status === 'stale') return 'binding_stale'
  if (!binding || binding.status !== 'active') {
    const projected = projectMatchOverviewState(occurrence?.lastSongStatus)
    if (projected) return projected
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

function buildOverviewTarget(
  neteaseSongId: number,
  occurrence: PlaylistSourceTrackOccurrence | null,
): MatchOverviewTarget {
  const title = occurrence?.title || ''
  const artists = occurrence?.artists ?? []
  const albumName = occurrence?.albumName || ''
  return {
    neteaseSongId,
    title,
    artists,
    albumName,
    coverUrl: occurrence?.coverUrl || '',
    metadataSource: title || artists.length || albumName ? 'occurrence' : 'unknown',
  }
}

export function queryMatchOverviewReadModel(filters: {
  sourceId: string | 'orphaned'
  origin?: 'scored'
  state?: MatchOverviewState | 'needs_action' | 'problem'
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
        WHERE binding.status != 'unbound'
          AND NOT EXISTS (
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
          target: buildOverviewTarget(row.netease_song_id, null),
          occurrence: null,
          binding,
          localMedia: localMedia.get(row.netease_song_id) ?? null,
          state: overviewState(null, binding),
          affectedSources: [],
        }
      })
    : occurrences.map(occurrence => {
        const binding = bindings.get(occurrence.neteaseSongId) ?? null
        return {
          target: buildOverviewTarget(occurrence.neteaseSongId, occurrence),
          occurrence,
          binding,
          localMedia: localMedia.get(occurrence.neteaseSongId) ?? null,
          state: overviewState(occurrence, binding),
          affectedSources: affected.get(occurrence.neteaseSongId) ?? [],
        }
      })
  const query = filters.search?.trim().toLocaleLowerCase()
  const filtered = candidates.filter(item => {
    if (filters.origin === 'scored' && !item.binding?.evidence?.quickDecision) return false
    if (filters.state && !filterMembers(mediaGroups, filters.state).includes(item.state)) return false
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
