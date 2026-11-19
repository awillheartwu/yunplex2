import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { BatchPlexCandidate } from '../../../types/match-management'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { plexTrackFilePaths } from '../plex-media'
import { compareRecording, hasRecordingMetadata } from '../source-initialization/recording-evidence'
import { findPlexIdentityOwners, normalizePlexPath } from './identity-store'
import { findPlaylistSongOccurrence } from './match-management-store'

export function batchPlexSong(songId: number, sourceId?: string): NeteaseSong | null {
  const occurrence = findPlaylistSongOccurrence(songId, sourceId)
  if (!occurrence) return null
  return {
    id: songId,
    name: occurrence.title,
    artists: occurrence.artists.filter(name => typeof name === 'string' && name.trim()).map(name => ({ name })),
    no: occurrence.trackNumber ?? 0,
    disc: String(occurrence.discNumber ?? ''),
    dt: occurrence.durationMs ?? 0,
    album: { id: occurrence.albumId ?? 0, name: occurrence.albumName, picUrl: occurrence.coverUrl, publishTime: 0 },
  }
}

/** Preview and save must use the same recording and ownership checks. */
export function assessBatchPlexCandidate(song: NeteaseSong, track: PlexTrack, sectionKey: string, config: InitializationMatchingConfig): BatchPlexCandidate | null {
  if (!hasRecordingMetadata(song)) return null
  const paths = [...new Set(plexTrackFilePaths(track).map(normalizePlexPath).filter(Boolean))]
  if (paths.length !== 1) return null
  const plexFilePath = paths[0]!
  const recording = { ...track, Media: [{ Part: [{ file: plexFilePath }] }] }
  const target = compareRecording(song, recording, config)
  if (!target.reviewable) return null

  const bindings = findPlexIdentityOwners({ neteaseSongId: song.id, plexFilePath, plexRatingKey: track.ratingKey })
  if (!bindings.length && !target.recommend) return null
  const owners = bindings.map(binding => batchPlexSong(binding.neteaseSongId))
  let shareIssue: string | undefined
  if (bindings.some(binding => binding.plexSectionKey !== sectionKey || binding.plexRatingKey !== track.ratingKey || binding.plexFilePath !== plexFilePath)) {
    shareIssue = '已有绑定的 Plex 编号或路径不同，请先核对原关联。'
  } else if (bindings.length && /\[netease-\d+\]/i.test(plexFilePath)) {
    shareIssue = '文件已标记具体的网易云歌曲 ID，无法共用。'
  } else if (bindings.length) {
    let plexArtistConfirmed = target.artistsMatch
    for (const owner of owners) {
      if (!owner || !hasRecordingMetadata(owner)) {
        shareIssue = '已关联歌曲资料不足，需核对原关联。'
        break
      }
      const ownerAsTrack = { ...recording, title: owner.name, originalTitle: '', grandparentTitle: owner.artists.map(artist => artist.name).join(' & '),
        parentTitle: owner.album.name, duration: owner.dt, index: owner.no }
      const songAgreement = compareRecording(song, ownerAsTrack, config)
      if (!songAgreement.reviewable || !songAgreement.artistsMatch) {
        shareIssue = '已关联歌曲和候选的曲名、艺人、版本或时长有差异，请先核对原关联。'
        break
      }
      if (!plexArtistConfirmed) {
        const fileAgreement = compareRecording(owner, recording, config)
        plexArtistConfirmed = fileAgreement.reviewable && fileAgreement.artistsMatch
      }
    }
    if (!shareIssue && !plexArtistConfirmed) shareIssue = '还无法核对 Plex 艺人与网易云艺人是否一致。'
  }

  return {
    ratingKey: track.ratingKey,
    title: track.title,
    artist: (config.useTrackArtist && track.originalTitle) || track.grandparentTitle || '',
    album: track.parentTitle || '',
    durationMs: Number(track.duration) || null,
    plexFilePath,
    owners: bindings.map((binding, index) => {
      const owner = owners[index]
      return { songId: binding.neteaseSongId, updatedAt: binding.updatedAt, title: owner?.name ?? '',
        artists: owner?.artists.map(artist => artist.name) ?? [], album: owner?.album.name ?? '', durationMs: owner?.dt || null }
    }),
    shareIssue,
  }
}
