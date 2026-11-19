import { getTracksByRatingKeys, type PlexTrack } from '../plex-client'
import { isPlexMediaPathAvailable, isPlexTrackAvailable } from '../plex-media'
import type { AppConfig } from '../config/types'
import type { SongIdentityBinding } from './identity-store'
import { normalizePlexPath, plexPathsExactlyEqual, resolvePlexIdentityPath } from './identity-normalization'
import { playlistWriteError } from './playlist-write-state'

export function playlistIdentityValidator(bindings: ReadonlyMap<number, SongIdentityBinding>, config: AppConfig) {
  const expected = new Map<string, Set<string>>()
  for (const binding of bindings.values()) {
    if (binding.status !== 'active' || !binding.plexRatingKey) continue
    const path = resolvePlexIdentityPath({ relativePath: binding.plexRelativePath,
      currentSectionRoot: config.download.plexLibraryPathPrefix, lastObservedPath: binding.plexFilePath })
    if (!path) continue
    const paths = expected.get(binding.plexRatingKey) ?? new Set<string>()
    paths.add(normalizePlexPath(path))
    expected.set(binding.plexRatingKey, paths)
  }
  function validateTracks(tracks: readonly PlexTrack[]) {
    for (const track of tracks) {
      const paths = expected.get(String(track.ratingKey))
      if (!paths) continue
      const actual = (track.Media ?? []).flatMap(media => media.Part ?? []).flatMap(part => part.file ? [part.file] : [])
      if (!isPlexTrackAvailable(track) || [...paths].some(path => !isPlexMediaPathAvailable(path, config)
        || !actual.some(value => plexPathsExactlyEqual(value, path)))) {
        throw playlistWriteError(`Plex 媒体 #${track.ratingKey} 的文件身份或可用性已变化，停止本轮写入`, 'media_identity_conflict')
      }
    }
  }
  async function validateInsert(keys: readonly string[]) {
    if (keys.some(key => !expected.has(key))) throw playlistWriteError('待加入媒体缺少有效绑定和文件路径证据', 'media_identity_conflict')
    const tracks = await getTracksByRatingKeys([...keys])
    if (keys.some(key => !tracks.has(key))) throw playlistWriteError('待加入 Plex 媒体已消失，停止本轮写入', 'media_identity_conflict')
    validateTracks([...tracks.values()])
  }
  return { validateTracks, validateInsert }
}
