import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { isArtistNameMatch } from './artist-match'
import { normalizeTitle, t2s, titleIdentityDescriptorsCompatible } from './matchers'

export type HighConfidenceMetadataFailureReason =
  | 'title_mismatch'
  | 'complete_artist_credit_unavailable'
  | 'artist_set_mismatch'
  | 'album_mismatch'
  | 'track_number_missing'
  | 'track_number_mismatch'
  | 'duration_missing'
  | 'duration_out_of_tolerance'

export interface HighConfidenceMetadataEvidence {
  matched: boolean
  title: { desired: string; candidate: string; matched: boolean }
  artists: { desired: string[]; candidate: string[]; matched: boolean; completeCreditAvailable: boolean }
  album: { desired: string; candidate: string; matched: boolean }
  trackNumber: { desired: number; candidate: number | null; matched: boolean }
  duration: {
    desiredMs: number
    candidateMs: number | null
    deltaMs: number | null
    toleranceMs: number
    matched: boolean
  }
  failureReasons: HighConfidenceMetadataFailureReason[]
}

const ARTIST_CREDIT_SEPARATOR = /\s*(?:&|\/|、|,|，|\+|;|；|\b(?:feat(?:uring)?|ft|with|and)\.?\b)\s*/giu

function splitArtistCredit(value: string): string[] {
  return value.split(ARTIST_CREDIT_SEPARATOR).map(part => part.trim()).filter(Boolean)
}

/**
 * Plex agents commonly keep only the primary artist in `grandparentTitle` and
 * move collaborators into the track title. Only explicit collaboration
 * markers inside brackets are accepted; version labels such as Live/Remix are
 * deliberately ignored.
 */
function extractFeaturedArtistsFromTitle(title: string): string[] {
  const artists: string[] = []
  const pattern = /(?:\(|\[)\s*(?:feat(?:uring)?|ft|with)\.?\s+([^)\]]+)\s*(?:\)|\])/giu
  for (const match of title.matchAll(pattern)) {
    artists.push(...splitArtistCredit(match[1] ?? ''))
  }
  return artists
}

function canonicalMetadata(value: string): string {
  return t2s(value.normalize('NFC'))
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function uniqueArtistCredits(artists: string[]): string[] {
  const seen = new Set<string>()
  return artists.filter((artist) => {
    const key = canonicalMetadata(artist)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function completeArtistSetMatches(desired: string[], candidate: string[]): boolean {
  if (desired.length === 0 || desired.length !== candidate.length) return false
  const unmatched = [...candidate]
  for (const artist of desired) {
    const index = unmatched.findIndex(value => canonicalMetadata(value) === canonicalMetadata(artist))
    if (index < 0) return false
    unmatched.splice(index, 1)
  }
  return unmatched.length === 0
}

/** Strict all-fields proof: every required field must be present and pass. */
export function evaluateHighConfidenceMetadataMatch(
  song: NeteaseSong,
  track: PlexTrack,
  durationToleranceMs: number,
  resolvedArtistNames: string[] = [],
): HighConfidenceMetadataEvidence {
  const desiredArtists = song.artists.map(artist => artist.name.trim()).filter(Boolean)
  const candidateArtistCredit = track.originalTitle?.trim() || track.grandparentTitle?.trim() || ''
  const candidateArtists = uniqueArtistCredits([
    ...splitArtistCredit(candidateArtistCredit),
    ...extractFeaturedArtistsFromTitle(track.title),
  ])
  const completeCreditAvailable = desiredArtists.length <= 1 || candidateArtists.length === desiredArtists.length
  const titleMatched = titleIdentityDescriptorsCompatible(song.name, track.title)
    && canonicalMetadata(normalizeTitle(song.name)) === canonicalMetadata(normalizeTitle(track.title))
  const singleArtistAliasMatched = desiredArtists.length === 1 && candidateArtists.length === 1
    && resolvedArtistNames.some(alias => isArtistNameMatch(candidateArtists[0]!, alias))
  const artistsMatched = completeCreditAvailable
    && (completeArtistSetMatches(desiredArtists, candidateArtists) || singleArtistAliasMatched)
  const albumMatched = Boolean(song.album.name && track.parentTitle)
    && canonicalMetadata(song.album.name) === canonicalMetadata(track.parentTitle)
  const index = Number(track.index)
  const candidateTrackNumber = Number.isInteger(index) && index > 0 ? index : null
  const trackNumberMatched = song.no > 0 && candidateTrackNumber === song.no
  const candidateDuration = typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0
    ? track.duration
    : null
  const toleranceMs = Math.max(0, durationToleranceMs)
  const deltaMs = candidateDuration === null || song.dt <= 0 ? null : Math.abs(candidateDuration - song.dt)
  const durationMatched = deltaMs !== null && deltaMs <= toleranceMs

  const failureReasons: HighConfidenceMetadataFailureReason[] = []
  if (!titleMatched) failureReasons.push('title_mismatch')
  if (!completeCreditAvailable) failureReasons.push('complete_artist_credit_unavailable')
  else if (!artistsMatched) failureReasons.push('artist_set_mismatch')
  if (!albumMatched) failureReasons.push('album_mismatch')
  if (candidateTrackNumber === null || song.no <= 0) failureReasons.push('track_number_missing')
  else if (!trackNumberMatched) failureReasons.push('track_number_mismatch')
  if (candidateDuration === null || song.dt <= 0) failureReasons.push('duration_missing')
  else if (!durationMatched) failureReasons.push('duration_out_of_tolerance')

  return {
    matched: failureReasons.length === 0,
    title: { desired: song.name, candidate: track.title, matched: titleMatched },
    artists: { desired: desiredArtists, candidate: candidateArtists, matched: artistsMatched, completeCreditAvailable },
    album: { desired: song.album.name, candidate: track.parentTitle, matched: albumMatched },
    trackNumber: { desired: song.no, candidate: candidateTrackNumber, matched: trackNumberMatched },
    duration: { desiredMs: song.dt, candidateMs: candidateDuration, deltaMs, toleranceMs, matched: durationMatched },
    failureReasons,
  }
}
