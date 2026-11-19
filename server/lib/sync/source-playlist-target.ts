import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'
import type { JobStepContext } from '../job/types'
import { getDb } from '../db'
import { updateSource } from '../playlist/store'
import { createPlaylist, getPlaylistWriteTracks, playlistInsertBatches } from '../plex-client'
import { classifyErrorCode } from '../domain-error'
import type { PlaylistWriteProgress } from '../../../shared/playlist-write'
import type { PlaylistMutationOwner } from './playlist-mutations'
import { recoverPlaylistMutation } from './playlist-mutations'
import { playlistWriteItems } from './playlist-write-snapshot'
import { sourceConvergenceSettingsKey } from './effective-settings'
import { clearPendingPlaylistWrite, pendingPlaylistWrite, playlistWriteError, savePendingPlaylistWrite, writeRequestDefinitelyEnded, type PendingPlaylistWrite } from './playlist-write-state'

/** Called inside the existing identity boundary, only after strong targets have been established. */
export async function ensureSourcePlaylistTarget(input: {
  source: PlaylistSource; config: AppConfig; playlist: { ratingKey: string; title: string }; targets: string[];
  context: JobStepContext; owner: PlaylistMutationOwner; onProgress?: (value: PlaylistWriteProgress) => void;
  onTarget?: (key: string) => void;
}): Promise<void> {
  const { source, playlist, targets, context, owner } = input
  owner.assertCurrent()
  const pending = pendingPlaylistWrite(source.id)
  if (pending?.kind === 'create' && !pending.playlistKey) {
    throw playlistWriteError('上次创建 Plex 歌单的结果未知，不会按同名认领或重发；请在收藏设置中明确指定实际歌单后重试')
  }
  const bind = (key: string) => {
    getDb().transaction(() => {
      owner.assertCurrent()
      updateSource(source.id, { plexPlaylistRatingKey: key, requiresMatchReconcile: true })
      source.plexPlaylistRatingKey = key
      playlist.ratingKey = key
      context.plexPlaylistRatingKey = key
      input.onTarget?.(key)
    })()
  }
  if (playlist.ratingKey) {
    if (source.plexPlaylistRatingKey !== playlist.ratingKey) bind(playlist.ratingKey)
    context.plexPlaylistRatingKey = playlist.ratingKey
    return
  }
  if (!targets.length) return
  if (pending) throw playlistWriteError('来源仍有未确认的 Plex 写入，不能创建新目标')
  if (!source.autoCreatePlexPlaylist) throw new Error('未允许自动创建 Plex 歌单')
  const first = playlistInsertBatches(targets)[0]!
  await owner.validateInsert?.(first)
  owner.assertCurrent()
  const state: PendingPlaylistWrite = { kind: 'create', playlistKey: '', scope: owner.scope, before: [], expected: [], ratingKeys: first,
    sourceSettingsKey: sourceConvergenceSettingsKey(source, input.config),
    submitted: first.length, acknowledged: false, startedAt: new Date().toISOString() }
  savePendingPlaylistWrite(source.id, state)
  input.onProgress?.({ phase: 'creating', submitted: first.length, confirmed: 0, total: first.length, batch: 1, batches: 1 })
  let target: { ratingKey: string; title: string }
  try { target = await createPlaylist(playlist.title, first) }
  catch (error) {
    if (writeRequestDefinitelyEnded(error)) clearPendingPlaylistWrite(source.id)
    const code = classifyErrorCode(error, 'failed_plex_insert')
    throw playlistWriteError('创建 Plex 歌单未取得可确认的目标，已停止自动重建；请核对后明确指定实际目标',
      code === 'plex_authentication_failed' || writeRequestDefinitelyEnded(error) ? code : 'plex_write_uncertain', error)
  }
  // Preserve the returned ID even if configuration drift prevents binding it to this source.
  state.playlistKey = target.ratingKey
  state.acknowledged = true
  savePendingPlaylistWrite(source.id, state)
  bind(target.ratingKey)
  const tracks = await getPlaylistWriteTracks(target.ratingKey)
  owner.assertCurrent()
  owner.validateTracks?.(tracks)
  recoverPlaylistMutation(owner, target.ratingKey, playlistWriteItems(tracks))
  input.onProgress?.({ phase: 'creating', submitted: first.length, confirmed: first.length, total: first.length, batch: 1, batches: 1 })
}
