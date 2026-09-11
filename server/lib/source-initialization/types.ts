import type { PlexTrack } from '../plex-client'

export const INITIALIZATION_RULE_VERSION = 1

export type SourceInitializationStatus = 'pending' | 'analyzing' | 'awaiting_review' | 'applying' | 'completed' | 'failed' | 'cancelled' | 'skipped'
export type InitializationTier = 'preserved' | 'strong_id' | 'high_confidence' | 'possible' | 'ambiguous' | 'unmatched' | 'metadata_missing' | 'conflict'
export type InitializationDecision = 'adopt' | 'download' | 'defer'
export type InitializationDecisionStatus = 'proposed' | 'applied' | 'deferred' | 'conflict' | 'failed'

export interface InitializationCandidate {
  ratingKey: string
  title: string
  artist: string
  album: string
  durationMs: number | null
  trackNumber: number | null
  filePath: string | null
}

export interface InitializationItemPlan {
  neteaseSongId: number
  position: number
  occurrenceCount: number
  title: string
  artists: string[]
  album: string
  trackNumber: number | null
  durationMs: number | null
  tier: InitializationTier
  candidate: InitializationCandidate | null
  candidates: InitializationCandidate[]
  evidence: Record<string, unknown>
  expectedBindingUpdatedAt: string | null
  decision: InitializationDecision
}

export interface SourceInitializationSummary {
  id: string
  sourceId: string
  runId: string | null
  followUpRunId: string | null
  trigger: string
  status: SourceInitializationStatus
  ruleVersion: number
  rulesCompatible: boolean
  requestId: string | null
  requestStatus: string | null
  neteaseCursor: string | null
  plexFingerprint: string | null
  totalItems: number
  preservedItems: number
  strongItems: number
  highConfidenceItems: number
  possibleItems: number
  ambiguousItems: number
  unmatchedItems: number
  adoptItems: number
  downloadItems: number
  deferredItems: number
  conflictItems: number
  summary: string
  error: string | null
  createdAt: string
  startedAt: string | null
  analyzedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export function plexCandidate(track: PlexTrack): InitializationCandidate {
  const filePath = track.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [])[0] ?? null
  const duration = Number(track.duration)
  const index = Number(track.index)
  return {
    ratingKey: track.ratingKey,
    title: track.title || '',
    artist: track.grandparentTitle || '',
    album: track.parentTitle || '',
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : null,
    trackNumber: Number.isInteger(index) && index > 0 ? index : null,
    filePath,
  }
}

export interface InitializationCommitResult {
  applied: number
  deferred: number
  downloads: number
  conflicts: number
  shouldSync: boolean
  sourceId: string
  followUpRequestId: string | null
}

export type InitializationReviewItem = Omit<InitializationItemPlan, 'decision'> & {
  initializationId: string
  decisionStatus: InitializationDecisionStatus
} & (
  | { kind: 'preserved'; decision: null; allowedDecisions: []; canSearch: false; unavailableReason: string }
  | { kind: 'actionable'; decision: InitializationDecision; allowedDecisions: InitializationDecision[]; canSearch: boolean; unavailableReason: string | null }
)
export interface InitializationItemsPage {
  items: InitializationReviewItem[]
  total: number
  page: number
  pageSize: number
}
