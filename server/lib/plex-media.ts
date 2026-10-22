import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { AppConfig } from './config/types'
import type { PlexTrack } from './plex-client'
import { mapPlexPathToLocal } from './sync/path-map'

export function isPlexTrackAvailable(track: { deletedAt?: number | string } | null | undefined): boolean {
  return Boolean(track && !Number(track.deletedAt))
}

/** Paths outside the configured shared library remain Plex's responsibility. */
export function isPlexMediaPathAvailable(plexPath: string, config: AppConfig): boolean {
  const localPath = mapPlexPathToLocal(plexPath, config)
  if (!localPath) return true
  const suffix = relative(resolve(config.download.dir), localPath)
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) return true
  try {
    return statSync(localPath).isFile()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
}

export function filterAvailablePlexTracks(tracks: readonly PlexTrack[], config: AppConfig): PlexTrack[] {
  return tracks.filter(isPlexTrackAvailable).flatMap(track => {
    const Media = (track.Media ?? []).map(media => ({
      ...media,
      Part: (media.Part ?? []).filter(part => part.file && isPlexMediaPathAvailable(part.file, config)),
    })).filter(media => media.Part.length > 0)
    return Media.length > 0 ? [{ ...track, Media }] : []
  })
}
