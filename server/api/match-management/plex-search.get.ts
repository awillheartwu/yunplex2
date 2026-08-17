import { readConfigFromDb } from '../../lib/db'
import {
  getSectionKey,
  getTrackFilePathByRatingKey,
  initPlexClient,
  searchTracksByTitle,
} from '../../lib/plex-client'
import { fail, success } from '../../lib/response'

/** Search is only a picker for explicit adoption; it never creates identity automatically. */
export default defineEventHandler(async (event) => {
  const title = typeof getQuery(event).title === 'string' ? String(getQuery(event).title).trim() : ''
  if (!title) return fail('请提供歌曲标题')
  const cfg = readConfigFromDb()
  await initPlexClient(cfg.plex)
  const sectionKey = await getSectionKey(cfg.plex.section)
  if (!sectionKey) return fail('未找到 Plex 音乐库分区')
  const tracks = await searchTracksByTitle(sectionKey, title)
  const result = await Promise.all(tracks.slice(0, 50).map(async track => ({
    ratingKey: track.ratingKey,
    title: track.title,
    artist: track.grandparentTitle || '',
    album: track.parentTitle || '',
    plexFilePath: await getTrackFilePathByRatingKey(track.ratingKey),
  })))
  return success({ sectionKey, tracks: result })
})
