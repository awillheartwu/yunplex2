import { createHash } from 'node:crypto'
import { normalizePlexPath } from './identity-normalization'

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

export interface OrderedSnapshotDiff {
  added: string[]
  removed: string[]
  reordered: boolean
}

export interface PlexPathTrack {
  ratingKey: string
  Media?: Array<{ Part?: Array<{ file?: string }> }>
}

export function serializeOrderedSnapshot(values: ReadonlyArray<string | number>): string {
  return JSON.stringify(values.map(value => String(value)))
}

export function parseOrderedSnapshot(value: string | null | undefined): string[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string' || typeof item === 'number')
      ? parsed.map(item => String(item))
      : null
  } catch {
    return null
  }
}

/** Compare order and duplicate occurrences without materialising an O(n²) matrix. */
export function diffOrderedSnapshot(
  previous: readonly string[],
  current: readonly string[],
): OrderedSnapshotDiff {
  const previousPositions = new Map<string, number[]>()
  previous.forEach((value, index) => {
    const positions = previousPositions.get(value) ?? []
    positions.push(index)
    previousPositions.set(value, positions)
  })
  const consumed = new Set<number>()
  const added: string[] = []
  const matchedPositions: number[] = []
  for (const value of current) {
    const positions = previousPositions.get(value)
    const index = positions?.find(position => !consumed.has(position))
    if (index === undefined) {
      added.push(value)
      continue
    }
    consumed.add(index)
    matchedPositions.push(index)
  }
  const removed = previous.filter((_, index) => !consumed.has(index))
  let reordered = false
  for (let index = 1; index < matchedPositions.length; index++) {
    if (matchedPositions[index]! < matchedPositions[index - 1]!) {
      reordered = true
      break
    }
  }
  return { added, removed, reordered }
}

export function buildPlexPathMap(tracks: readonly PlexPathTrack[]): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const track of tracks) {
    const path = (track.Media ?? [])
      .flatMap(media => media.Part ?? [])
      .find(part => part.file)?.file
    const normalized = path ? normalizePlexPath(path) : ''
    if (normalized) paths[String(track.ratingKey)] = normalized
  }
  return paths
}

/** Keep the file path each Plex playlist occurrence resolved to at write time. */
export function buildPlexPathSnapshot(tracks: readonly PlexPathTrack[]): string {
  return JSON.stringify(buildPlexPathMap(tracks))
}

export function parsePlexPathSnapshot(value: string | null | undefined): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

/**
 * Applied rating keys that no longer resolve to the same file. A missing key
 * covers both external removal and Plex replacing the media identity; the
 * old key is still the one a song binding points at, so both must be checked.
 */
export function findChangedPlexRatingKeys(
  applied: Readonly<Record<string, string>>,
  observed: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(applied)
    .filter(([ratingKey, path]) => observed[ratingKey] !== path)
    .map(([ratingKey]) => ratingKey)
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
