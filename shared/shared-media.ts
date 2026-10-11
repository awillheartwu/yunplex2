export interface SharedMediaReview {
  ratingKey: string
  filePath: string
  songs: Array<{ songId: number; title: string; artists: string[]; album: string; albumId?: number; publishTime?: number; durationMs: number | null; bindingVersion: string | null }>
}
export function sharedMediaReview(evidence: Record<string, unknown>): SharedMediaReview | null {
  const value = evidence.sharedMedia as SharedMediaReview | undefined
  if (!value || typeof value.ratingKey !== 'string' || !value.ratingKey || typeof value.filePath !== 'string' || !value.filePath || !Array.isArray(value.songs) || value.songs.length < 2) return null
  if (!value.songs.every(song => Number.isSafeInteger(song.songId) && typeof song.title === 'string' && Array.isArray(song.artists) && typeof song.album === 'string' && (song.bindingVersion === null || typeof song.bindingVersion === 'string'))) return null
  return value
}
