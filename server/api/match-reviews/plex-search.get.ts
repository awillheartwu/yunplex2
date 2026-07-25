import { fail, success } from '../../lib/response'
import { readConfigFromDb } from '../../lib/db'
import {
  getPlexTrackMusicBrainzIdentity,
  getPlexTrackRecordingId,
  getSectionKey,
  getTrackFilePathByRatingKey,
  initPlexClient,
  searchTracksByTitle,
} from '../../lib/plex-client'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const title = typeof query.title === 'string' ? query.title.trim() : ''
  if (!title) return fail('请提供歌曲标题')
  const cfg = readConfigFromDb()
  await initPlexClient(cfg.plex)
  const sectionKey = await getSectionKey(cfg.plex.section)
  if (!sectionKey) return fail('未找到 Plex 音乐库分区')
  const tracks = await searchTracksByTitle(sectionKey, title)
  const result = await Promise.all(tracks.slice(0, 50).map(async track => ({
    ratingKey: track.ratingKey, title: track.title, artist: track.grandparentTitle || '', album: track.parentTitle || '',
    plexFilePath: await getTrackFilePathByRatingKey(track.ratingKey),
    mbRecordingId: getPlexTrackRecordingId(track),
    musicBrainzIdentity: getPlexTrackMusicBrainzIdentity(track),
  })))
  return success({ sectionKey, tracks: result })
})
