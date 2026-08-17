import type { PlexTrack } from '../plex-client'
import { getPlexTrackMusicBrainzIdentity, getPlexTrackRecordingId } from '../plex-client'
import type { MatchReview } from '~~/types/match-review'
import type { MatchReviewDecisionBinding } from './identity-store'
import { normalizePlexPath } from './identity-normalization'

export function buildAcceptedReviewBinding(input: {
  review: MatchReview
  track: PlexTrack | null
  sectionKey: string | null
  sectionRoot: string
}): MatchReviewDecisionBinding {
  const { review, track, sectionKey, sectionRoot } = input
  if (!track) throw new Error(`Plex 曲目不存在：${review.candidatePlexRatingKey || review.id}`)
  if (!sectionKey) throw new Error('未找到 Plex 音乐库分区')

  const plexPaths = track.Media
    ?.flatMap(media => media.Part?.map(part => part.file).filter((file): file is string => Boolean(file)) ?? [])
    ?? []
  const expectedPath = normalizePlexPath(review.candidatePlexFilePath ?? '')
  const plexFilePath = plexPaths.find(path => normalizePlexPath(path) === expectedPath) ?? plexPaths[0]
  if (!plexFilePath) throw new Error(`Plex 曲目“${track.title}”没有可绑定的媒体路径`)

  return {
    plexSectionKey: sectionKey,
    plexSectionRoot: sectionRoot,
    plexFilePath,
    plexRatingKey: track.ratingKey,
    // Explicit null clears a MusicBrainz id inherited from a previous binding.
    mbRecordingId: getPlexTrackRecordingId(track) ?? null,
    evidence: {
      selectedBy: 'user',
      selectedRatingKey: track.ratingKey,
      plexMusicBrainzIdentity: getPlexTrackMusicBrainzIdentity(track),
    },
  }
}
