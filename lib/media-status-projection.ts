import type { SongStatus } from '~~/server/lib/job/types'
import type { Resolution } from '~~/server/lib/sync/types'
import type { MatchOverviewState } from '~~/types/match-management'

type StaticSongProjection = {
  status: SongStatus
  phase: 'download' | 'tags' | 'plex_match' | 'plex_insert' | 'done'
}

const STATIC_RESOLUTION_PROJECTIONS: Partial<Record<Resolution, StaticSongProjection>> = {
  matched_plex_playlist: { status: 'skipped_existing', phase: 'done' },
  found_in_plex_library: { status: 'skipped_existing', phase: 'done' },
  copyright_restricted: { status: 'copyright_restricted', phase: 'download' },
  awaiting_manual: { status: 'awaiting_manual_match', phase: 'done' },
}

const OVERVIEW_STATE_BY_SONG_STATUS: Partial<Record<SongStatus, MatchOverviewState>> = {
  awaiting_manual_match: 'awaiting_manual',
  copyright_restricted: 'copyright_restricted',
  ignored_failure: 'retry_paused',
}

const ATTENTION_STATUSES = new Set<SongStatus>([
  'copyright_restricted',
  'ignored_failure',
  'awaiting_manual_match',
])

export function projectStaticResolutionStatus(resolution: Resolution): StaticSongProjection | null {
  return STATIC_RESOLUTION_PROJECTIONS[resolution] ?? null
}

export function projectMatchOverviewState(status: string | null | undefined): MatchOverviewState | null {
  return status ? OVERVIEW_STATE_BY_SONG_STATUS[status as SongStatus] ?? null : null
}

export function isAttentionSongStatusProjection(status: SongStatus): boolean {
  return ATTENTION_STATUSES.has(status)
}

export function isDistinctWarningSongStatus(status: SongStatus): boolean {
  return status === 'extra_skipped' || ATTENTION_STATUSES.has(status)
}

export function isAwaitingManualSongStatus(status: SongStatus): boolean {
  return status === 'awaiting_manual_match'
}
