import { readConfigFromDb } from '../../../../lib/db'
import { fetchAlbumSongs, fetchPlaylistSongs } from '../../../../lib/netease'
import { getSource, updateSource } from '../../../../lib/playlist/store'
import { fail, success } from '../../../../lib/response'
import { observePlaylistSourceTracks } from '../../../../lib/sync/match-management-store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')
  const source = getSource(id)
  if (!source) return fail('歌单源不存在')
  const cfg = readConfigFromDb()
  const rawLimit = source.syncLimit ?? cfg.sync.songLimit
  const limit = rawLimit === 0 ? undefined : rawLimit
  try {
    if (source.type === 'album') {
      const songs = await fetchAlbumSongs(source.neteasePlaylistId, cfg.netease.cookie)
      observePlaylistSourceTracks({
        sourceId: source.id,
        managedSongs: songs,
        managedSongIds: songs.map(song => song.id),
        allSongIds: songs.map(song => song.id),
      })
      updateSource(source.id, { trackCount: songs.length })
      return success({ sourceId: source.id, trackCount: songs.length }, '目标清单已刷新，未修改 Plex')
    }
    const result = await fetchPlaylistSongs(source.neteasePlaylistId, limit, cfg.netease.cookie)
    observePlaylistSourceTracks({
      sourceId: source.id,
      managedSongs: result.songs,
      managedSongIds: result.trackIds.map(track => track.id),
      allSongIds: result.allTrackIds.map(track => track.id),
    })
    updateSource(source.id, {
      trackCount: result.trackIds.length,
      neteasePlaylistName: result.playlistName ?? source.neteasePlaylistName,
    })
    return success({
      sourceId: source.id,
      trackCount: result.trackIds.length,
      completeTrackCount: result.allTrackIds.length,
    }, '目标清单已刷新，未修改 Plex')
  } catch (error) {
    // The previous authoritative snapshot remains untouched when upstream is
    // incomplete or unavailable.
    return fail(error instanceof Error ? error.message : '刷新网易云目标清单失败')
  }
})
