import { getDb } from '../db'
import { failureSubjectKey, plexRemovalTarget } from '../tasks/failure-identity'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { recoveryDecision, recoveryIsDue } from '../../../shared/error-recovery'
import { confirmPlaylistItemAbsent, supersedePlaylistItemRemoval } from '../tasks/completion'

export interface SourceFailurePolicyEntry {
  failureKind: string
  failureReason: string
  occurrenceCount: number
  attemptCount: number
  status: 'open' | 'ignored'
  phase: 'download' | 'tags' | 'plex_match' | 'plex_insert'
  lastSeenAt?: string
}

export interface SourceFailurePolicy {
  failuresBySongId: Record<number, SourceFailurePolicyEntry>
  removalFailures: Record<string, SourceFailurePolicyEntry>
}

export function getSourceFailureStatus(sourceId: string): 'open' | 'ignored' | null {
  const row = getDb().prepare(`SELECT status FROM failure_records WHERE subject_key = ?
    AND status IN ('open', 'ignored') ORDER BY status = 'open' ASC LIMIT 1`)
    .get(failureSubjectKey({ sourceId, songName: '来源同步' })) as { status: 'open' | 'ignored' } | undefined
  return row?.status ?? null
}

function phaseForFailureKind(failureKind: string): SourceFailurePolicyEntry['phase'] {
  if (failureKind === 'failed_tags') return 'tags'
  if (failureKind === 'failed_plex_match') return 'plex_match'
  if (failureKind === 'failed_plex_insert') return 'plex_insert'
  return 'download'
}

export function getSourceFailurePolicy(sourceId: string): SourceFailurePolicy {
  // A newly approved replacement can proceed without deleting older failure history.
  const rows = getDb().prepare(`
    SELECT subject_key, song_id, failure_kind, failure_reason, occurrence_count, attempt_count, last_seen_at, status
    FROM failure_records
    WHERE source_id = ?
      AND status IN ('open', 'ignored')
      AND failure_kind != 'ignored_failure'
      AND (song_id IS NULL OR NOT EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
        WHERE member.source_id=failure_records.source_id AND member.netease_song_id=failure_records.song_id)
        OR EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
        WHERE member.source_id=failure_records.source_id AND member.netease_song_id=failure_records.song_id AND member.membership_status='current'))
      AND NOT EXISTS (
        SELECT 1 FROM media_corrections correction
        WHERE correction.song_id = failure_records.song_id
          AND correction.status IN ('pending', 'ready')
          AND correction.updated_at > failure_records.last_seen_at
      )
    ORDER BY status = 'ignored' DESC, last_seen_at DESC, rowid DESC
  `).all(sourceId) as Array<{
    subject_key: string
    song_id: number | null
    failure_kind: string
    failure_reason: string
    occurrence_count: number
    attempt_count: number
    last_seen_at: string
    status: 'open' | 'ignored'
  }>
  const failuresBySongId: Record<number, SourceFailurePolicyEntry> = {}
  const removalFailures: Record<string, SourceFailurePolicyEntry> = {}

  for (const row of rows) {
    const entry: SourceFailurePolicyEntry = {
      failureKind: row.failure_kind,
      failureReason: row.failure_reason,
      occurrenceCount: row.occurrence_count,
      attemptCount: row.attempt_count,
      status: row.status,
      phase: phaseForFailureKind(row.failure_kind),
      lastSeenAt: row.last_seen_at,
    }
    if (row.song_id !== null) failuresBySongId[row.song_id] ??= entry
    else if (plexRemovalTarget(row.subject_key)) removalFailures[row.subject_key] ??= entry
  }

  return { failuresBySongId, removalFailures }
}

export function getOpenMediaIdentityConflict(entry: SourceFailurePolicyEntry | undefined) {
  if (entry?.status !== 'open' || entry.failureKind !== 'media_identity_conflict') return null
  return {
    phase: entry.phase,
    message: entry.failureReason || resolveDomainErrorDefinition('media_identity_conflict').userMessage,
  }
}

/** A missing concrete item is already removed; an ignored present item stays untouched. */
export function observePlexRemovalFailures(input: {
  sourceId: string
  playlistRatingKey: string
  currentItemIds: ReadonlySet<number>
  maxFailureAttempts: number
}): Set<number> {
  const ignored = new Set<number>()
  for (const [subject, failure] of Object.entries(getSourceFailurePolicy(input.sourceId).removalFailures)) {
    const target = plexRemovalTarget(subject)!
    if (target.plexPlaylistRatingKey !== input.playlistRatingKey) continue
    if (!input.currentItemIds.has(target.plexPlaylistItemId)) {
      confirmPlaylistItemAbsent(input.sourceId, target)
    } else if (shouldDeferFailure(failure, input.maxFailureAttempts)) {
      ignored.add(target.plexPlaylistItemId)
    }
  }
  return ignored
}

/** A verified current target supersedes an old removal request, not a deletion. */
export function resolveSupersededPlexRemovals(input: {
  sourceId: string
  playlistRatingKey: string
  retainedItemIds: ReadonlySet<number>
}): void {
  for (const [subject, failure] of Object.entries(getSourceFailurePolicy(input.sourceId).removalFailures)) {
    if (failure.status !== 'open') continue
    const target = plexRemovalTarget(subject)!
    if (target.plexPlaylistRatingKey === input.playlistRatingKey && !input.retainedItemIds.has(target.plexPlaylistItemId)) continue
    supersedePlaylistItemRemoval(input.sourceId, target)
  }
}

/** Execution reads one recovery rule; reaching the fast budget never changes problem status. */
export function shouldDeferFailure(entry: SourceFailurePolicyEntry | undefined, maxFailures: number): boolean {
  if (!entry) return false
  return !recoveryIsDue(recoveryDecision({ errorCode: resolveDomainErrorDefinition(entry.failureKind).code,
    status: entry.status, attemptCount: entry.attemptCount, attemptLimit: maxFailures,
    lastSeenAt: entry.lastSeenAt ?? new Date(0).toISOString() }))
}
