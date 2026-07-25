import { createHash } from 'node:crypto'

export interface PlexPlaylistOccurrence {
  ratingKey: string
  /**
   * Plex allocates this id for the membership row, not the media identity.
   * It is intentionally excluded from the content fingerprint so a Plex-side
   * reallocation does not look like a playlist edit.
   */
  playlistItemID?: string | number | null
}

export interface NeteasePlaylistObservation {
  trackIds: Array<string | number>
  trackUpdateTime: number | null
}

export interface PlexPlaylistFingerprintBaseline {
  lastObservedPlexFingerprint: string | null
  lastAppliedPlexFingerprint: string | null
}

export type PlexPlaylistObservationKind =
  | 'initial'
  | 'matches_last_applied'
  | 'unchanged_external_state'
  | 'external_change'

function versionedHash(namespace: string, value: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
  return `${namespace}:${digest}`
}

/**
 * Fingerprints the ordered media occurrences in a Plex playlist.
 *
 * Order and duplicates are significant. `playlistItemID` is not: Plex may
 * reallocate membership ids while preserving the exact same playlist content.
 */
export function buildPlexPlaylistFingerprint(occurrences: readonly PlexPlaylistOccurrence[]): string {
  const ratingKeys = occurrences.map((occurrence, index) => {
    const ratingKey = String(occurrence.ratingKey).normalize('NFC').trim()
    if (!ratingKey) throw new Error(`Plex playlist occurrence at index ${index} has no ratingKey`)
    return ratingKey
  })
  return versionedHash('plex-playlist-v1', ratingKeys)
}

/**
 * Builds an opaque cursor for a fetched NetEase playlist snapshot. This is an
 * observation/comparison cursor, not proof that Plex converged to the target.
 */
export function buildNeteasePlaylistCursor(observation: NeteasePlaylistObservation): string {
  const trackIds = observation.trackIds.map(id => String(id).normalize('NFC').trim())
  return versionedHash('netease-playlist-v1', {
    trackUpdateTime: observation.trackUpdateTime,
    trackIds,
  })
}

/**
 * Classifies content drift without consulting Plex's coarse `updatedAt` value.
 * A fingerprint verified after our own write is explicitly recognized as an
 * application state; a different fingerprint is external only when it is new.
 */
export function classifyPlexPlaylistObservation(
  currentFingerprint: string,
  baseline: PlexPlaylistFingerprintBaseline,
): PlexPlaylistObservationKind {
  if (baseline.lastAppliedPlexFingerprint === currentFingerprint) return 'matches_last_applied'
  if (baseline.lastObservedPlexFingerprint === currentFingerprint) return 'unchanged_external_state'
  if (!baseline.lastObservedPlexFingerprint && !baseline.lastAppliedPlexFingerprint) return 'initial'
  return 'external_change'
}
