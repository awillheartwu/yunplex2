export interface MusicBrainzArtistAlias {
  name: string
  locale?: string | null
  primary?: boolean
}

export interface MusicBrainzResolveResult {
  matchedName: string | null
  score: number | null
  aliases: MusicBrainzArtistAlias[]
  disambiguation?: string | null
}

export type MusicBrainzRecordingStatus = 'success' | 'ambiguous' | 'empty' | 'failed'

export type MusicBrainzRecordingQueryStrategy =
  | 'title_artist_release'
  | 'title_release'
  | 'title_artist'
  | 'title_only'

export type MusicBrainzRecordingAmbiguityReason =
  | 'insufficient_constraints'
  | 'below_threshold'
  | 'runner_up_too_close'
  | 'identity_descriptor_mismatch'

export interface MusicBrainzRecordingCandidate {
  id: string
  score: number
  title: string
  artist: string | null
  /** MusicBrainz recording length. Null means MB did not publish one. */
  lengthMs: number | null
  /** Derived against the requested duration and persisted for auditability. */
  durationDeltaMs?: number | null
  /** False for identity-changing variants such as Instrumental/Live/Remix. */
  titleDescriptorCompatible?: boolean
}

export interface MusicBrainzRecordingResolutionOptions {
  durationMs?: number | null
  durationToleranceMs?: number
  minDurationSeparationMs?: number
}

export type MusicBrainzDurationResolutionOutcome =
  | 'selected'
  | 'missing_candidate_durations'
  | 'outside_tolerance'
  | 'duration_tie'
  | 'runner_up_too_close'

export interface MusicBrainzDurationEvidence {
  targetMs: number
  toleranceMs: number
  minSeparationMs: number
  selectedCandidateId: string | null
  closestDeltaMs: number | null
  runnerUpDeltaMs: number | null
  separationMs: number | null
  outcome: MusicBrainzDurationResolutionOutcome
}

export interface MusicBrainzRecordingResult {
  id: string | null
  score: number | null
  title: string | null
  artist: string | null
  status: MusicBrainzRecordingStatus
  candidates: MusicBrainzRecordingCandidate[]
  runnerUpGap: number | null
  queryStrategy: MusicBrainzRecordingQueryStrategy
  attemptedStrategies: MusicBrainzRecordingQueryStrategy[]
  ambiguityReason: MusicBrainzRecordingAmbiguityReason | null
  failureReason: string | null
  policy: { minScore: number; minRunnerUpGap: number }
  cacheHit: boolean
  /** Actual title variant used for the final query/classification. */
  queryTitle?: string
  /** Ordered title variants attempted, retained for review evidence. */
  attemptedTitles?: string[]
  /** Present when duration participated in resolving or preserving ambiguity. */
  durationEvidence?: MusicBrainzDurationEvidence
}

export type MusicBrainzIdEntityType = 'recording' | 'release_track' | 'unknown'

export interface MusicBrainzIdMappingResult {
  inputId: string
  recordingId: string | null
  entityType: MusicBrainzIdEntityType
  status: MusicBrainzRecordingStatus
  candidateRecordingIds: string[]
  failureReason: string | null
  cacheHit: boolean
}

export type MusicBrainzRecordingArtistInput = string | readonly string[]
