import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { candidateFacts } from './candidate-facts'
import { BILINGUAL_TITLE_STRENGTH, DURATION_FALLBACK_RATIO, scoreCandidate } from './candidate-score'
import { corroboratedArtistEvidence } from './corroborated-recommendation'

export function hasRecordingMetadata(song: NeteaseSong): boolean {
  return Boolean(song.name.trim() && song.artists.some(artist => artist.name.trim()) && song.dt > 0)
}

export function compareRecording(song: NeteaseSong, track: PlexTrack, config: InitializationMatchingConfig,
  facts = candidateFacts(song, track, config), score = scoreCandidate(song, track, config, facts)) {
  const artistsMatch = facts.artist.complete
    || (config.ignoreMissingCollaborators && facts.artist.missingCollaborators)
    || Boolean(corroboratedArtistEvidence(song, track, config, facts))
  const reviewable = score.titleStrength >= BILINGUAL_TITLE_STRENGTH
    && !facts.version.excluded && !facts.version.conflicts.length && !facts.version.review.length
    && facts.delta !== null && facts.delta <= config.reviewDurationMs
  return { reviewable, artistsMatch, recommend: hasRecordingMetadata(song) && reviewable && artistsMatch && score.eligible && facts.recommendedDuration }
}

/** An existing binding may be intentional. Report concrete differences for review. */
export function recordingReview(song: NeteaseSong, track: PlexTrack, config: InitializationMatchingConfig): string[] {
  if (!hasRecordingMetadata(song)) return []
  const facts = candidateFacts(song, track, config)
  const score = scoreCandidate(song, track, config, facts)
  const issues: string[] = []
  if (track.title?.trim() && score.titleStrength < BILINGUAL_TITLE_STRENGTH) issues.push('曲名不同')
  if (facts.version.conflicts.length || facts.version.review.length) issues.push('录音版本不同')
  if (score.blocked.includes('artist-mismatch') && !facts.artist.missing) issues.push('艺人不同')
  if (facts.delta !== null && facts.delta > Math.max(config.reviewDurationMs, song.dt * DURATION_FALLBACK_RATIO)) {
    issues.push(`时长相差 ${(facts.delta / 1000).toFixed(1)} 秒`)
  }
  return issues
}
