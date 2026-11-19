import { fail, success } from '../../../lib/response'
import { getDb, readConfigFromDb } from '../../../lib/db'
import { getSource, updateSourceSettings } from '../../../lib/playlist/store'
import { getPlaylistByRatingKey, getPlaylistWriteTracks, initPlexClient, isWritableAudioPlaylist } from '../../../lib/plex-client'
import { acquireIdentityMutationLock } from '../../../lib/sync/identity-coordinator'
import { assertPlaylistWriteContext, acknowledgePlaylistTargetSelection, playlistWriteError } from '../../../lib/sync/playlist-write-state'
import { playlistWriteItems } from '../../../lib/sync/playlist-write-snapshot'
import { getSyncWorker } from '../../../lib/sync/instance'

/** Explicit target confirmation, including selecting the same target after an uncertain write. */
export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')
  const body = await readBody<{ ratingKey?: string }>(event)
  if (typeof body.ratingKey !== 'string' || !/^\d+$/.test(body.ratingKey)) return fail('请选择实际的 Plex 歌单')
  const release = await acquireIdentityMutationLock()
  try {
    const source = getSource(id)
    if (!source) return fail('歌单源不存在')
    if (getDb().prepare("SELECT 1 FROM source_sync_queue WHERE source_id=? AND status='running'").get(id)) {
      throw playlistWriteError('请先取消此来源的同步并等待结束，再确认实际目标', 'concurrent_operation')
    }
    const config = readConfigFromDb()
    await initPlexClient(config.plex)
    const playlist = await getPlaylistByRatingKey(body.ratingKey)
    if (!playlist || playlist.ratingKey !== body.ratingKey) return fail('Plex 目标歌单已不存在')
    if (!isWritableAudioPlaylist(playlist)) return fail('请选择普通音乐歌单；智能、视频和照片歌单不能作为同步目标')
    // The explicit choice establishes an actual occurrence baseline, never a title-only adoption.
    playlistWriteItems(await getPlaylistWriteTracks(playlist.ratingKey))
    assertPlaylistWriteContext(source, config)
    const updated = getDb().transaction(() => {
      acknowledgePlaylistTargetSelection(id, playlist.ratingKey)
      return updateSourceSettings(id, { plexPlaylistRatingKey: playlist.ratingKey, plexPlaylistName: playlist.title,
        requiresMatchReconcile: true, lastObservedPlexFingerprint: null, lastAppliedPlexFingerprint: null,
        observedPlexPaths: null, appliedPlexPaths: null, plexUpdatedAt: null })
    })()
    getSyncWorker()?.update()
    return success({ ...updated, pendingPlexWrite: null }, '目标已明确确认；下一次同步将重新核对歌单')
  } catch (error) { return fail(error, 1, 'plex_unavailable') }
  finally { release() }
})
