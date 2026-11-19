import { createHash } from 'node:crypto'

function normalizePart(value: string | number | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export interface FailureSubject {
  songId?: number | null
  songName: string
  artist?: string
  sourceId?: string | null
  plexPlaylistRatingKey?: string
  plexPlaylistItemId?: number
}

export function plexRemovalTarget(subjectKey: string): { plexPlaylistRatingKey: string; plexPlaylistItemId: number } | null {
  const match = /^plex-item:([^:]+):([1-9]\d*):source:/.exec(subjectKey)
  if (!match) return null
  const plexPlaylistItemId = Number(match[2])
  if (!Number.isSafeInteger(plexPlaylistItemId)) return null
  return { plexPlaylistRatingKey: decodeURIComponent(match[1]!), plexPlaylistItemId }
}

export function failureSubjectKey(input: FailureSubject): string {
  const resource = input.songId
    ? `netease:${input.songId}`
    : input.plexPlaylistRatingKey && input.plexPlaylistItemId
      ? `plex-item:${encodeURIComponent(input.plexPlaylistRatingKey)}:${input.plexPlaylistItemId}`
      : `text:${normalizePart(input.songName)}:${normalizePart(input.artist)}`
  return `${resource}:source:${normalizePart(input.sourceId || 'manual')}`
}

export function failureFingerprint(input: FailureSubject & {
  failureKind: string
}): string {
  const raw = `${failureSubjectKey(input)}:kind:${normalizePart(input.failureKind)}`
  return createHash('sha256').update(raw).digest('hex')
}

export function normalizeFailureIdentityPart(value: string | number | null | undefined): string {
  return normalizePart(value)
}

export function failureReasonGroupKey(kind: string, reason: string): string {
  return createHash('sha256').update(JSON.stringify([kind, kind === 'copyright_restricted' ? '' : reason])).digest('hex')
}
