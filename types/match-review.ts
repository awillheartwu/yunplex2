export type BindingMethod = 'path' | 'mb_recording' | 'metadata' | 'manual' | 'migrated'
export type BindingStatus = 'active' | 'stale' | 'unbound'
export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'unbound' | 'superseded'
export type ReviewEvidenceType = 'path' | 'mb_recording' | 'metadata' | 'historical' | 'manual' | 'migration'

export interface SongIdentityBinding {
  neteaseSongId: number
  plexSectionKey: string
  /** Last observed Plex path, retained for diagnostics and backward compatibility. */
  plexFilePath: string
  /** Canonical, NFC-normalized path relative to the configured Plex music root. */
  plexRelativePath: string
  plexRatingKey: string | null
  mbRecordingId: string | null
  bindingMethod: BindingMethod
  status: BindingStatus
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastVerifiedAt: string | null
}

export interface MatchReview {
  id: string
  neteaseSongId: number
  sourceId: string | null
  runId: string | null
  candidatePlexFilePath: string | null
  candidatePlexRatingKey: string | null
  candidateMbRecordingId: string | null
  evidenceType: ReviewEvidenceType
  evidence: Record<string, unknown>
  status: ReviewStatus
  decision: string | null
  createdAt: string
  decidedAt: string | null
}

export interface MatchReviewWithBinding extends MatchReview {
  binding: SongIdentityBinding | null
}

export interface MatchReviewCounts {
  pending: number
  accepted: number
  rejected: number
  unbound: number
  superseded: number
  activeBindings: number
}

export interface MatchReviewSourceFacet {
  sourceId: string
  name: string
  count: number
}

export interface MatchReviewEvidenceFacet {
  evidenceType: ReviewEvidenceType
  count: number
}

export interface MatchReviewPage {
  items: MatchReviewWithBinding[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  counts: MatchReviewCounts
  facets: {
    sources: MatchReviewSourceFacet[]
    evidenceTypes: MatchReviewEvidenceFacet[]
  }
}
