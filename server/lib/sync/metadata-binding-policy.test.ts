import { describe, expect, it } from 'vitest'
import type { MusicBrainzRecordingResult } from '../integrations/musicbrainz'
import { evaluateMetadataBindingMusicBrainzEvidence } from './metadata-binding-policy'

function ambiguous(candidates: Array<{
  id: string
  durationDeltaMs: number
  titleDescriptorCompatible?: boolean
}>): MusicBrainzRecordingResult {
  return {
    id: null,
    score: null,
    title: null,
    artist: null,
    status: 'ambiguous',
    candidates: candidates.map(candidate => ({
      score: 82,
      title: 'Song',
      artist: 'Artist',
      lengthMs: 200000,
      titleDescriptorCompatible: true,
      ...candidate,
    })),
    runnerUpGap: 0,
    queryStrategy: 'title_artist_release',
    attemptedStrategies: ['title_artist_release'],
    ambiguityReason: 'runner_up_too_close',
    failureReason: null,
    policy: { minScore: 90, minRunnerUpGap: 5 },
    cacheHit: false,
  }
}

describe('metadata binding MusicBrainz policy', () => {
  it('allows metadata proof when MusicBrainz has no usable identity', () => {
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: null,
      candidateRecordingId: null,
      desiredEvidence: { ...ambiguous([]), status: 'empty' },
      candidateEvidence: { ...ambiguous([]), status: 'empty' },
      plexUntypedIdCount: 0,
      plexIdMappings: [],
      durationToleranceMs: 2000,
    })).toMatchObject({ allowed: true, mode: 'unavailable' })
  })

  it('uses a successfully mapped Plex recording to disambiguate a target candidate', () => {
    const recordingId = '017cb61b-b382-479a-bfff-918619b25678'
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: null,
      candidateRecordingId: recordingId,
      desiredEvidence: ambiguous([
        { id: 'remix', durationDeltaMs: 120, titleDescriptorCompatible: false },
        { id: recordingId, durationDeltaMs: 1940 },
      ]),
      candidateEvidence: null,
      plexUntypedIdCount: 1,
      plexIdMappings: [{ status: 'success', recordingId }],
      durationToleranceMs: 2000,
    })).toMatchObject({
      allowed: true,
      mode: 'candidate_in_target_ambiguity',
      confirmedRecordingId: recordingId,
    })
  })

  it('rejects a mapped target candidate with incompatible version or duration evidence', () => {
    const base = {
      desiredRecordingId: null,
      candidateRecordingId: 'recording',
      candidateEvidence: null,
      plexUntypedIdCount: 1,
      plexIdMappings: [{ status: 'success' as const, recordingId: 'recording' }],
      durationToleranceMs: 2000,
    }

    expect(evaluateMetadataBindingMusicBrainzEvidence({
      ...base,
      desiredEvidence: ambiguous([{ id: 'recording', durationDeltaMs: 10, titleDescriptorCompatible: false }]),
    }).allowed).toBe(false)
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      ...base,
      desiredEvidence: ambiguous([{ id: 'recording', durationDeltaMs: 2001 }]),
    }).allowed).toBe(false)
  })

  it('allows identical, fully compatible ambiguity sets on both sides', () => {
    const candidates = [
      { id: 'recording-a', durationDeltaMs: 472 },
      { id: 'recording-b', durationDeltaMs: 472 },
    ]
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: null,
      candidateRecordingId: null,
      desiredEvidence: ambiguous(candidates),
      candidateEvidence: ambiguous(candidates.map(item => ({ ...item, durationDeltaMs: 422 }))),
      plexUntypedIdCount: 0,
      plexIdMappings: [],
      durationToleranceMs: 2000,
    })).toMatchObject({
      allowed: true,
      mode: 'concordant_ambiguity',
      concordantCandidateIds: ['recording-a', 'recording-b'],
    })
  })

  it('does not accept partial ambiguity overlap, explicit conflict, or failed ID mapping', () => {
    const shared = ambiguous([
      { id: 'recording-a', durationDeltaMs: 100 },
      { id: 'recording-b', durationDeltaMs: 100 },
    ])
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: null,
      candidateRecordingId: null,
      desiredEvidence: shared,
      candidateEvidence: ambiguous([
        { id: 'recording-a', durationDeltaMs: 100 },
        { id: 'recording-c', durationDeltaMs: 100 },
      ]),
      plexUntypedIdCount: 0,
      plexIdMappings: [],
      durationToleranceMs: 2000,
    }).allowed).toBe(false)
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: 'desired',
      candidateRecordingId: 'candidate',
      desiredEvidence: null,
      candidateEvidence: null,
      plexUntypedIdCount: 0,
      plexIdMappings: [],
      durationToleranceMs: 2000,
    }).allowed).toBe(false)
    expect(evaluateMetadataBindingMusicBrainzEvidence({
      desiredRecordingId: null,
      candidateRecordingId: null,
      desiredEvidence: null,
      candidateEvidence: null,
      plexUntypedIdCount: 1,
      plexIdMappings: [{ status: 'failed', recordingId: null }],
      durationToleranceMs: 2000,
    }).allowed).toBe(false)
  })
})
