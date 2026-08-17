import type { MatchReview, ReviewEvidenceType, ReviewStatus } from '~~/types/match-review'
import { parseJsonObject } from '../json'

export type MatchReviewRow = {
  id: string
  netease_song_id: number
  source_id: string | null
  run_id: string | null
  candidate_plex_file_path: string | null
  candidate_plex_rating_key: string | null
  candidate_mb_recording_id: string | null
  candidate_key: string
  evidence_type: ReviewEvidenceType
  evidence_json: string
  status: ReviewStatus
  decision: string | null
  created_at: string
  decided_at: string | null
}


const REVIEW_EVIDENCE_TYPES = new Set<ReviewEvidenceType>([
  'path', 'mb_recording', 'metadata', 'historical', 'manual', 'migration',
])

export function mapMatchReviewRow(row: MatchReviewRow): MatchReview {
  return {
    id: row.id,
    neteaseSongId: row.netease_song_id,
    sourceId: row.source_id,
    runId: row.run_id,
    candidatePlexFilePath: row.candidate_plex_file_path,
    candidatePlexRatingKey: row.candidate_plex_rating_key,
    candidateMbRecordingId: row.candidate_mb_recording_id,
    evidenceType: REVIEW_EVIDENCE_TYPES.has(row.evidence_type) ? row.evidence_type : 'historical',
    evidence: parseJsonObject(row.evidence_json),
    status: row.status,
    decision: row.decision,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}
