import { createHash } from 'node:crypto'

function normalizePart(value: string | number | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function failureSubjectKey(input: {
  songId?: number | null
  songName: string
  artist?: string
  sourceId?: string | null
}): string {
  const resource = input.songId
    ? `netease:${input.songId}`
    : `text:${normalizePart(input.songName)}:${normalizePart(input.artist)}`
  return `${resource}:source:${normalizePart(input.sourceId || 'manual')}`
}

export function failureFingerprint(input: {
  songId?: number | null
  songName: string
  artist?: string
  sourceId?: string | null
  failureKind: string
}): string {
  const raw = `${failureSubjectKey(input)}:kind:${normalizePart(input.failureKind)}`
  return createHash('sha256').update(raw).digest('hex')
}

export function normalizeFailureIdentityPart(value: string | number | null | undefined): string {
  return normalizePart(value)
}
