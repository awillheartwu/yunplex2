import type {
  MusicBrainzRecordingResult,
  MusicBrainzRecordingStatus,
} from '../integrations/musicbrainz'

export type MetadataBindingMusicBrainzMode =
  | 'unavailable'
  | 'candidate_in_target_ambiguity'
  | 'concordant_ambiguity'
  | 'blocked'

export interface MetadataBindingMusicBrainzDecision {
  allowed: boolean
  mode: MetadataBindingMusicBrainzMode
  reason: string
  confirmedRecordingId: string | null
  concordantCandidateIds: string[]
}

interface PlexIdMappingEvidence {
  status: MusicBrainzRecordingStatus
  recordingId: string | null
}

interface MetadataBindingMusicBrainzInput {
  desiredRecordingId: string | null
  candidateRecordingId: string | null
  desiredEvidence: MusicBrainzRecordingResult | null
  candidateEvidence: MusicBrainzRecordingResult | null
  plexUntypedIdCount: number
  plexIdMappings: PlexIdMappingEvidence[]
  durationToleranceMs: number
}

function blocked(reason: string): MetadataBindingMusicBrainzDecision {
  return {
    allowed: false,
    mode: 'blocked',
    reason,
    confirmedRecordingId: null,
    concordantCandidateIds: [],
  }
}

function candidateIds(evidence: MusicBrainzRecordingResult | null): string[] {
  return [...new Set((evidence?.candidates ?? []).map(candidate => candidate.id).filter(Boolean))].sort()
}

function candidateIsCompatible(
  evidence: MusicBrainzRecordingResult | null,
  recordingId: string,
  durationToleranceMs: number,
): boolean {
  const candidate = evidence?.candidates?.find(item => item.id === recordingId)
  return Boolean(
    candidate
    && candidate.titleDescriptorCompatible === true
    && candidate.durationDeltaMs !== null
    && candidate.durationDeltaMs !== undefined
    && candidate.durationDeltaMs <= durationToleranceMs,
  )
}

function allCandidatesCompatible(
  evidence: MusicBrainzRecordingResult | null,
  ids: string[],
  durationToleranceMs: number,
): boolean {
  return ids.length > 0 && ids.every(id => candidateIsCompatible(evidence, id, durationToleranceMs))
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Decides whether MusicBrainz evidence is compatible with an otherwise
 * all-fields metadata proof. It never turns a conflicting or failed identity
 * lookup into a match.
 */
export function evaluateMetadataBindingMusicBrainzEvidence(
  input: MetadataBindingMusicBrainzInput,
): MetadataBindingMusicBrainzDecision {
  const {
    desiredRecordingId,
    candidateRecordingId,
    desiredEvidence,
    candidateEvidence,
    plexUntypedIdCount,
    plexIdMappings,
  } = input
  const durationToleranceMs = Math.max(0, input.durationToleranceMs)

  if (desiredRecordingId && candidateRecordingId && desiredRecordingId !== candidateRecordingId) {
    return blocked('resolved_recording_conflict')
  }
  if (desiredEvidence?.status === 'failed' || candidateEvidence?.status === 'failed') {
    return blocked('musicbrainz_lookup_failed')
  }

  if (plexUntypedIdCount > 0) {
    const mappingsComplete = plexIdMappings.length === plexUntypedIdCount
      && plexIdMappings.every(mapping => mapping.status === 'success' && Boolean(mapping.recordingId))
    if (!mappingsComplete) return blocked('plex_generic_id_not_fully_mapped')
    if (candidateRecordingId
      && plexIdMappings.some(mapping => mapping.recordingId !== candidateRecordingId)) {
      return blocked('plex_generic_id_mapping_conflict')
    }
  }

  if (desiredRecordingId && candidateRecordingId && desiredRecordingId === candidateRecordingId) {
    return {
      allowed: true,
      mode: 'candidate_in_target_ambiguity',
      reason: 'resolved_recording_equal',
      confirmedRecordingId: desiredRecordingId,
      concordantCandidateIds: [],
    }
  }

  if (
    !desiredRecordingId
    && candidateRecordingId
    && desiredEvidence?.status === 'ambiguous'
    && candidateIsCompatible(desiredEvidence, candidateRecordingId, durationToleranceMs)
  ) {
    return {
      allowed: true,
      mode: 'candidate_in_target_ambiguity',
      reason: 'plex_recording_uniquely_identifies_compatible_target_candidate',
      confirmedRecordingId: candidateRecordingId,
      concordantCandidateIds: [],
    }
  }

  if (
    !desiredRecordingId
    && !candidateRecordingId
    && plexUntypedIdCount === 0
    && desiredEvidence?.status === 'ambiguous'
    && candidateEvidence?.status === 'ambiguous'
  ) {
    const desiredIds = candidateIds(desiredEvidence)
    const candidateSideIds = candidateIds(candidateEvidence)
    if (
      sameIds(desiredIds, candidateSideIds)
      && allCandidatesCompatible(desiredEvidence, desiredIds, durationToleranceMs)
      && allCandidatesCompatible(candidateEvidence, candidateSideIds, durationToleranceMs)
    ) {
      return {
        allowed: true,
        mode: 'concordant_ambiguity',
        reason: 'both_sides_have_identical_compatible_recording_candidates',
        confirmedRecordingId: null,
        concordantCandidateIds: desiredIds,
      }
    }
    return blocked('musicbrainz_ambiguity_sets_differ_or_are_not_compatible')
  }

  const mbUnavailable = !desiredRecordingId
    && !candidateRecordingId
    && plexUntypedIdCount === 0
    && desiredEvidence?.status !== 'ambiguous'
    && candidateEvidence?.status !== 'ambiguous'
  if (mbUnavailable) {
    return {
      allowed: true,
      mode: 'unavailable',
      reason: 'no_usable_musicbrainz_identity',
      confirmedRecordingId: null,
      concordantCandidateIds: [],
    }
  }

  return blocked('musicbrainz_evidence_not_safe_for_metadata_binding')
}
