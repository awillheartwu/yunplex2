import type { SongIdentityBinding } from './match-review'

export type TrackMembershipStatus = 'current' | 'removed'
export type TrackRemovalReason = 'netease_removed' | 'sync_limit_excluded' | null
export type PlaylistAlignmentStatus = 'aligned' | 'pending' | 'missing' | 'unknown'

export type MatchOverviewState =
  | 'matched'
  | 'pending_alignment'
  | 'historical_unverified'
  | 'pending_review'
  | 'unmatched'
  | 'binding_stale'
  | 'copyright_restricted'
  | 'sync_failed'
  | 'retry_paused'
  | 'removed'

export interface PlaylistSourceTrackOccurrence {
  id: string
  sourceId: string
  neteaseSongId: number
  occurrence: number
  position: number
  title: string
  artists: string[]
  albumId: number | null
  albumName: string
  coverUrl: string
  trackNumber: number | null
  discNumber: number | null
  durationMs: number | null
  metadataComplete: boolean
  membershipStatus: TrackMembershipStatus
  removalReason: TrackRemovalReason
  lastSongStatus: string | null
  lastRunId: string | null
  matchTrace: Record<string, unknown> | null
  lastError: Record<string, unknown> | null
  alignmentStatus: PlaylistAlignmentStatus
  alignedPlexRatingKey: string | null
  alignedPlexRelativePath: string | null
  alignedBindingUpdatedAt: string | null
  alignedAt: string | null
  firstObservedAt: string
  lastObservedAt: string
  removedAt: string | null
}

export interface MatchOverviewTarget {
  neteaseSongId: number
  title: string
  artists: string[]
  albumName: string
  coverUrl: string
  metadataSource: 'occurrence' | 'review_evidence' | 'unknown'
}

export type SongIdentityEventType =
  | 'auto_bind'
  | 'auto_migrate'
  | 'invalidate'
  | 'manual_accept'
  | 'manual_reject'
  | 'manual_rebind'
  | 'manual_reevaluate'
  | 'manual_exclude'
  | 'migration_snapshot'

export interface SongIdentityEvent {
  id: string
  neteaseSongId: number
  eventType: SongIdentityEventType
  actorType: 'system' | 'admin'
  sourceId: string | null
  runId: string | null
  reviewId: string | null
  previousBinding: SongIdentityBinding | null
  nextBinding: SongIdentityBinding | null
  evidence: Record<string, unknown>
  createdAt: string
}

export interface MatchOverviewItem {
  target: MatchOverviewTarget
  occurrence: PlaylistSourceTrackOccurrence | null
  binding: SongIdentityBinding | null
  localMedia: {
    filePath: string
    ownership: 'managed' | 'external'
    provenance: 'download_task' | 'legacy_download_task' | 'computed' | 'manual'
    status: 'active' | 'missing' | 'replaced'
    evidence: Record<string, unknown>
    lastVerifiedAt: string | null
  } | null
  state: MatchOverviewState
  pendingReviewCount: number
  affectedSources: Array<{ id: string; name: string }>
}

export interface MatchOverviewPage {
  items: MatchOverviewItem[]
  total: number
  page: number
  pageSize: number
  staleAfterMinutes: number
}

export interface SongIdentityEventPage {
  items: SongIdentityEvent[]
  total: number
  page: number
  pageSize: number
}

export interface IdentityMutationImpact {
  neteaseSongId: number
  affectedSources: Array<{ id: string; name: string }>
  orphaned: boolean
}
