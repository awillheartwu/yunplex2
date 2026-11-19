import { createHash } from 'node:crypto'
import type { PlexTrack } from '../plex-client'
import { normalizePlexPath } from './identity-normalization'
import { playlistWriteError, type PlaylistWriteItem } from './playlist-write-state'

export function playlistWriteItems(tracks: readonly PlexTrack[]): PlaylistWriteItem[] {
  const ids = new Set<number>()
  return tracks.map(track => {
    const id = track.playlistItemID
    if (!id || !Number.isSafeInteger(id) || ids.has(id)) throw playlistWriteError('Plex 未返回唯一的具体歌单条目 ID，无法安全确认写入')
    ids.add(id)
    return { ratingKey: String(track.ratingKey), playlistItemId: id,
      filePaths: [...new Set((track.Media ?? []).flatMap(media => media.Part ?? []).flatMap(part => part.file ? [normalizePlexPath(part.file)] : []))].sort() }
  })
}
export function samePlaylistItems(expected: readonly PlaylistWriteItem[], actual: readonly PlaylistWriteItem[]): boolean {
  return expected.length === actual.length && expected.every((item, index) => samePlaylistItem(item, actual[index]!))
}
export function samePlaylistItem(expected: PlaylistWriteItem, actual: PlaylistWriteItem): boolean {
  return expected.playlistItemId === actual.playlistItemId && expected.ratingKey === actual.ratingKey
    && (expected.filePaths === undefined || JSON.stringify(expected.filePaths) === JSON.stringify(actual.filePaths))
}
export function playlistItemsHash(items: readonly PlaylistWriteItem[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex')
}

/** The old occurrences must survive in the same order; new occurrences may only satisfy this batch. */
export function inspectInsertedItems(before: readonly PlaylistWriteItem[], actual: readonly PlaylistWriteItem[], keys: readonly string[]) {
  const old = new Set(before.map(item => item.playlistItemId))
  const retained = actual.filter(item => old.has(item.playlistItemId))
  if (!samePlaylistItems(before, retained)) return null
  const required = new Map<string, number>()
  keys.forEach(key => required.set(key, (required.get(key) ?? 0) + 1))
  const inserted = actual.filter(item => !old.has(item.playlistItemId))
  for (const item of inserted) {
    const count = required.get(item.ratingKey) ?? 0
    if (!count) return null
    required.set(item.ratingKey, count - 1)
  }
  return { inserted, missing: [...required].flatMap(([key, count]) => Array<string>(count).fill(key)) }
}
