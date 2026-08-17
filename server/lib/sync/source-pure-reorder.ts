import type { AppConfig } from '../config/types'
import type { JobStepContext, SongStatus } from '../job/types'
import type { NeteaseSong } from '../netease'
import type { PlaylistSource } from '../playlist/types'
import { recordAppliedPlexPlaylistFingerprint } from '../playlist/store'
import {
  findPlaylist,
  getPlaylistByRatingKey,
  getPlaylistTracks,
  getSectionKey,
  initPlexClient,
} from '../plex-client'
import type { RunBuilder } from '../run/builder'
import { joinArtist } from './artist-utils'
import {
  acquireIdentityMutationLock,
  assertBindingVersionsUnchanged,
} from './identity-coordinator'
import { getActiveSongIdentityBindings } from './identity-store'
import { resolvePlexIdentityPath } from './identity-normalization'
import { buildPlexPlaylistFingerprint } from './playlist-fingerprint'
import { applyFullReorder } from './plex-reconciler'
import { PlexReorderError, validatePlaylistOrder } from './reorder'
import { validateCachedTargetOrder } from './reorder-cache'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'

interface PureSourceReorderInput {
  source: PlaylistSource
  songs: NeteaseSong[]
  config: AppConfig
  job: RunBuilder
  stepContext: JobStepContext
  dryRun: boolean
  currentIdOrder: number[]
  isCancellationRequested: () => boolean
  throwIfCancelled: () => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

/**
 * Apply the cache-backed reorder shortcut behind the same identity lock,
 * readback validation and failure projection on every caller.
 *
 * Returns false when cached identities cannot prove the complete target order;
 * the caller must then continue through full Source Convergence.
 */
export async function tryApplyPureSourceReorder(input: PureSourceReorderInput): Promise<boolean> {
  const {
    source,
    songs,
    config,
    job,
    stepContext,
    dryRun,
    currentIdOrder,
    isCancellationRequested,
    throwIfCancelled,
    log,
  } = input

  const identityBindings = getActiveSongIdentityBindings(currentIdOrder)
  const bindingVersionSnapshot = new Map([...new Set(currentIdOrder)].map(songId => [
    songId,
    identityBindings.get(songId)?.updatedAt ?? null,
  ]))
  const cacheKeys = new Map([...identityBindings].flatMap(([songId, binding]) =>
    binding.plexRatingKey ? [[songId, binding.plexRatingKey] as const] : [],
  ))
  const bindingPaths = new Map([...identityBindings].map(([songId, binding]) => [
    songId,
    resolvePlexIdentityPath({
      relativePath: binding.plexRelativePath,
      currentSectionRoot: config.download.plexLibraryPathPrefix,
      lastObservedPath: binding.plexFilePath,
    }),
  ]))

  await initPlexClient(config.plex)
  const cacheValidation = await validateCachedTargetOrder(songs, cacheKeys, undefined, bindingPaths)
  const targetOrder = cacheValidation.targetOrder
  if (!targetOrder) {
    log('warn', `歌单「${source.name || source.neteasePlaylistName}」纯重排缓存未通过校验，回退到完整对比`)
    return false
  }

  job.addSongs(source.id, songs.map((song, neteaseIndex) => ({
    songName: song.name,
    artist: joinArtist(song.artists),
    album: song.album.name,
    status: 'skipped_existing' as SongStatus,
    neteaseSongId: song.id,
    neteaseIndex,
  })))
  for (const song of job.getRun().songs) {
    if (song.sourceId === source.id) job.updateSong(song.id, { status: 'skipped_existing', phase: 'done' })
  }

  if (dryRun) return true

  const playlist = source.plexPlaylistRatingKey
    ? await getPlaylistByRatingKey(source.plexPlaylistRatingKey)
    : await findPlaylist(source.plexPlaylistName || source.neteasePlaylistName)
  if (!playlist) return true

  const sectionKey = (await getSectionKey(config.plex.section)) ?? ''
  const currentItems = (await getPlaylistTracks(playlist.ratingKey, 99999))
    .filter(track => track.playlistItemID)
    .map(track => ({ ratingKey: track.ratingKey, playlistItemId: track.playlistItemID! }))
  const reorderStep = job.startStep('reorder', '重排 Plex 歌单', { context: stepContext })
  let releaseIdentityLock: (() => void) | null = null

  try {
    releaseIdentityLock = await acquireIdentityMutationLock()
    assertBindingVersionsUnchanged(bindingVersionSnapshot)
    const currentBindings = getActiveSongIdentityBindings(currentIdOrder)
    for (const [songId, ratingKey] of cacheKeys) {
      if (currentBindings.get(songId)?.plexRatingKey !== ratingKey) {
        throw new Error(`歌曲 #${songId} 的身份已变化，本轮已安全中止 Plex 重排，请重试同步`)
      }
    }
    await applyFullReorder(
      playlist.ratingKey,
      targetOrder,
      currentItems,
      sectionKey,
      isCancellationRequested,
      (level, message) => log(level, message),
      { removalProtectionReason: '纯重排快捷路径不执行删除' },
    )
    const postPlaylistTracks = await getPlaylistTracks(playlist.ratingKey, 99999)
    const postItems = postPlaylistTracks
      .filter(track => track.playlistItemID)
      .map(track => ({ ratingKey: track.ratingKey, playlistItemId: track.playlistItemID! }))
    const orderValidation = validatePlaylistOrder(targetOrder, postItems, { allowExtra: true })
    if (!orderValidation.ok) {
      job.failStep(reorderStep, 'Plex 歌单重排校验失败', {
        title: 'Plex 歌单重排校验失败',
        message: 'Plex 写入完成后，实际歌单顺序与目标顺序不一致',
        stage: 'plex_insert',
        context: { ...orderValidation },
      })
      throw new Error('Plex 歌单重排校验失败')
    }
    recordAppliedPlexPlaylistFingerprint(
      source.id,
      buildPlexPlaylistFingerprint(postPlaylistTracks),
    )
    job.finishStep(reorderStep, 'success', 'Plex 歌单重排完成')
  } catch (error) {
    if (error instanceof PlexReorderError) {
      const ratingKeyToSongId = new Map<string, string>()
      for (const [neteaseSongId, ratingKey] of cacheKeys) {
        const taskSongId = job.findSongId(source.id, neteaseSongId)
        if (taskSongId) ratingKeyToSongId.set(ratingKey, taskSongId)
      }
      markPlexReorderFailures(job, error.result.failures, {
        ratingKeyToSongId,
        playlistItemIdToRatingKey: new Map(
          currentItems.map(item => [item.playlistItemId, item.ratingKey]),
        ),
      })
      job.failStep(reorderStep, 'Plex 歌单重排失败', buildPlexReorderStepError(error))
    }
    throw error
  } finally {
    releaseIdentityLock?.()
  }

  throwIfCancelled()
  return true
}
