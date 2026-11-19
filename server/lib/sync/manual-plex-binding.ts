import { getDb } from '../db'
import type { PlexTrack } from '../plex-client'
import { plexTrackFilePaths } from '../plex-media'
import { BindingVersionConflictError, getSongIdentityBinding, normalizePlexPath, rebindSongIdentity } from './identity-store'
import { queueIdentityRealignment } from './media-corrections'

/** Call under the identity mutation lock, after reading the selected track from Plex. */
export function saveManualPlexBinding(input: {
  songId: number
  expectedBindingUpdatedAt: string | null
  sourceId?: string
  track: PlexTrack
  sectionKey: string
  sectionRoot: string
  batch?: { changeId: string; plexFilePath: string; sharedWithSongIds?: number[] }
}) {
  const { songId, track, batch } = input
  const filePath = plexTrackFilePaths(track)[0]
  if (!filePath) throw new Error('Plex 曲目没有可绑定的媒体路径')
  const plexFilePath = normalizePlexPath(filePath)
  if (batch && plexFilePath !== normalizePlexPath(batch.plexFilePath)) {
    throw new Error('Plex 文件路径已变化，请重新选择')
  }

  const db = getDb()
  return db.transaction(() => {
    const previous = getSongIdentityBinding(songId)
    if (batch && previous && previous.status !== 'unbound') throw new BindingVersionConflictError()
    const updated = rebindSongIdentity({
      neteaseSongId: songId,
      expectedBindingUpdatedAt: input.expectedBindingUpdatedAt,
      sourceId: input.sourceId,
      sharedWithSongIds: batch?.sharedWithSongIds,
      binding: {
        plexSectionKey: input.sectionKey,
        plexSectionRoot: input.sectionRoot,
        plexFilePath,
        plexRatingKey: track.ratingKey,
        evidence: {
          previousBinding: previous ? { ratingKey: previous.plexRatingKey, filePath: previous.plexFilePath, version: previous.updatedAt } : null,
          selectedBy: 'user',
          selectedRatingKey: track.ratingKey,
          identityRule: 'explicit_adoption',
          ...(batch?.sharedWithSongIds ? { confirmedShareWithSongIds: batch.sharedWithSongIds } : {}),
        },
      },
    })
    db.prepare("UPDATE media_corrections SET status='cancelled',updated_at=? WHERE song_id=? AND status IN ('pending','ready')")
      .run(new Date().toISOString(), songId)
    return { ...updated, ...queueIdentityRealignment(songId, batch?.changeId ?? updated.binding.updatedAt) }
  })()
}
