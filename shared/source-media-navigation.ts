export function parseMediaSongId(value: unknown): number | undefined {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export function sourceMediaLink(sourceId?: string | null, songId?: number | null): string | null {
  const id = parseMediaSongId(songId)
  return sourceId?.trim() && id !== undefined
    ? `/sync-sources/${encodeURIComponent(sourceId)}?tab=media&songId=${id}`
    : null
}
