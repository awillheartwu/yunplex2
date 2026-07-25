import type { NeteaseSong } from '../netease'
import type { PlexTrack, PlexTrackNeteaseIdentity } from '../plex-client'
import { normalizeTitle, titleIdentityDescriptorsCompatible } from './matchers'

export type NeteaseProviderIdentityFailureReason =
  | 'source_artist_id_missing'
  | 'artist_id_mismatch'
  | 'album_id_mismatch'
  | 'track_number_mismatch'
  | 'disc_number_mismatch'
  | 'title_mismatch'
  | 'duration_missing'
  | 'duration_out_of_tolerance'

export interface NeteaseProviderIdentityEvidence {
  matched: boolean
  providerIdentity: PlexTrackNeteaseIdentity
  source: {
    songId: number
    artistIds: number[]
    albumId: number
    discNumber: number | null
    trackNumber: number
  }
  titleMatched: boolean
  duration: { desiredMs: number; candidateMs: number | null; deltaMs: number | null; toleranceMs: number; matched: boolean }
  failureReasons: NeteaseProviderIdentityFailureReason[]
}

function canonicalTitle(value: string): string {
  return normalizeTitle(value).normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function parseDiscNumber(value: string): number | null {
  const match = value.trim().match(/^\d+/)?.[0]
  const parsed = match ? Number(match) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Validate a Plex WangYiYun GUID against the authoritative NetEase payload.
 * Provider IDs are strong evidence only when every identity-bearing field and
 * the media duration agree; display-language artist aliases are irrelevant.
 */
export function evaluateNeteaseProviderIdentity(
  song: NeteaseSong,
  track: PlexTrack,
  identity: PlexTrackNeteaseIdentity,
  durationToleranceMs: number,
): NeteaseProviderIdentityEvidence {
  const artistIds = [...new Set(song.artists.map(artist => artist.id).filter((id): id is number => Number.isSafeInteger(id) && id! > 0))]
  const discNumber = parseDiscNumber(song.disc)
  const titleMatched = titleIdentityDescriptorsCompatible(song.name, track.title)
    && canonicalTitle(song.name) === canonicalTitle(track.title)
  const candidateDuration = typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0
    ? track.duration
    : null
  const toleranceMs = Math.max(0, durationToleranceMs)
  const deltaMs = candidateDuration !== null && song.dt > 0 ? Math.abs(candidateDuration - song.dt) : null
  const durationMatched = deltaMs !== null && deltaMs <= toleranceMs
  const failureReasons: NeteaseProviderIdentityFailureReason[] = []

  if (artistIds.length === 0) failureReasons.push('source_artist_id_missing')
  else if (!artistIds.includes(identity.artistId)) failureReasons.push('artist_id_mismatch')
  if (song.album.id <= 0 || identity.albumId !== song.album.id) failureReasons.push('album_id_mismatch')
  if (song.no <= 0 || identity.trackNumber !== song.no) failureReasons.push('track_number_mismatch')
  if (identity.discNumber !== null && (discNumber === null || identity.discNumber !== discNumber)) failureReasons.push('disc_number_mismatch')
  if (!titleMatched) failureReasons.push('title_mismatch')
  if (candidateDuration === null || song.dt <= 0) failureReasons.push('duration_missing')
  else if (!durationMatched) failureReasons.push('duration_out_of_tolerance')

  return {
    matched: failureReasons.length === 0,
    providerIdentity: identity,
    source: { songId: song.id, artistIds, albumId: song.album.id, discNumber, trackNumber: song.no },
    titleMatched,
    duration: { desiredMs: song.dt, candidateMs: candidateDuration, deltaMs, toleranceMs, matched: durationMatched },
    failureReasons,
  }
}
