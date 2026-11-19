import { parseMediaSongId } from '../../../shared/source-media-navigation'
import { DEFAULT_INITIALIZATION_MATCHING } from '../../../shared/initialization-matching'
import type { BatchPlexPreviewResult } from '../../../types/match-management'
import { readConfigFromDb } from '../../lib/db'
import {
  getSectionKey,
  getTrackFilePathByRatingKey,
  getTracksByRatingKeys,
  initPlexClient,
  searchTracksByTitle,
  type PlexTrack,
} from '../../lib/plex-client'
import { fail, failDomain, success } from '../../lib/response'
import { assessBatchPlexCandidate, batchPlexSong } from '../../lib/sync/batch-plex-matches'
import { hasRecordingMetadata } from '../../lib/source-initialization/recording-evidence'

function toCandidate(track: PlexTrack, plexFilePath: string | null) {
  return {
    ratingKey: track.ratingKey,
    title: track.title,
    artist: track.grandparentTitle || '',
    album: track.parentTitle || '',
    plexFilePath,
  }
}

/** Search is only a picker for explicit adoption; it never creates identity automatically. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const neteaseSongId = parseMediaSongId(query.availableForSongId)
  const firstAvailable = query.firstAvailable === '1'
  if ((firstAvailable || query.availableForSongId !== undefined) && neteaseSongId === undefined) {
    return failDomain('validation_failed', '请刷新页面并重新选择歌曲')
  }
  const sourceId = typeof query.sourceId === 'string' ? query.sourceId.trim() || undefined : undefined
  const song = neteaseSongId === undefined ? null : batchPlexSong(neteaseSongId, sourceId)
  if (neteaseSongId !== undefined && (!song || !hasRecordingMetadata(song))) {
    return success<BatchPlexPreviewResult>({ tracks: [], occupied: [], issue: song ? '缺少歌曲的曲名、艺人或时长，需手动核对。' : '找不到当前收藏中的歌曲，请刷新列表。' })
  }
  const title = song?.name ?? (typeof query.title === 'string' ? query.title.trim() : '')
  if (!title) return fail('请提供歌曲标题')
  const cfg = readConfigFromDb()
  await initPlexClient(cfg.plex)
  const sectionKey = await getSectionKey(cfg.plex.section)
  if (!sectionKey) return fail('未找到 Plex 音乐库分区')
  const tracks = (await searchTracksByTitle(sectionKey, title)).slice(0, 50)
  if (song) {
    const matching = cfg.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING
    const metadata = await getTracksByRatingKeys(tracks.map(track => track.ratingKey))
    const result: BatchPlexPreviewResult = { tracks: [], occupied: [] }
    for (const track of tracks) {
      const detail = metadata.get(track.ratingKey)
      const candidate = detail && assessBatchPlexCandidate(song, detail, sectionKey, matching)
      if (!candidate) continue
      if (candidate.owners.length) result.occupied.push(candidate)
      else result.tracks.push(candidate)
    }
    if (firstAvailable) result.tracks = result.tracks.slice(0, 1)
    return success({ sectionKey, ...result })
  }
  return success({ sectionKey, tracks: await Promise.all(tracks.map(async track => toCandidate(track, await getTrackFilePathByRatingKey(track.ratingKey)))) })
})
