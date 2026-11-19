/**
 * Pure candidate scoring protocol for source initialization.
 *
 * A score only ranks metadata agreement for review. It never authorizes a
 * media binding, a download, a file move or a Plex mutation, and it carries
 * no persisted state.
 */
export interface CandidateScoreParts {
  title: number
  artists: number
  duration: number
  album: number
  track: number
}

export interface CandidateScore {
  version: 1
  total: number
  eligible: boolean
  parts: CandidateScoreParts
  coverage: number
  blocked: string[]
  risks: string[]
  durationDeltaMs: number | null
  completeArtists: boolean
  titleStrength: number
}
