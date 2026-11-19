import type { AppConfig } from '../config/types'
import type { JobStepContext, SongStatus } from '../job/types'
import type { SyncStage } from '../log/types'
import type { NeteaseSong } from '../netease'
import type { PlaylistSource } from '../playlist/types'
import { recordAppliedPlexPlaylistFingerprint } from '../playlist/store'
import {
  getPlaylistByRatingKey,
  getPlaylistWriteTracks,
  getTracksByRatingKeys,
  getSectionKey,
  initPlexClient,
  isWritableAudioPlaylist,
} from '../plex-client'
import type { RunBuilder } from '../run/builder'
import { joinArtist } from './artist-utils'
import {
  acquireIdentityMutationLock,
  assertBindingVersionsUnchanged,
} from './identity-coordinator'
import { getActiveSongIdentityBindings } from './identity-store'
import { conflictingLookupOwner } from './lookup-identity'
import type { PlaylistAlignmentValidationInput } from './match-management-store'
import { captureSourceConvergenceCheckpoint, type SourceConvergenceCheckpoint } from './source-checkpoint'
import { resolvePlexIdentityPath } from './identity-normalization'
import {
  buildPlexPathSnapshot,
  buildPlexPlaylistFingerprint,
} from './playlist-fingerprint'
import { applyFullReorder } from './plex-reconciler'
import { PlexReorderError, createPlaylistOrderError, validatePlaylistOrder } from './reorder'
import { validateCachedTargetOrder } from './reorder-cache'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'
import type { PlaylistWriteProgress } from '../../../shared/playlist-write'
import { assertPlaylistWriteContext, pendingPlaylistWrite, playlistServerScope } from './playlist-write-state'
import { playlistIdentityValidator } from './playlist-write-identity'
import { playlistWriteItems } from './playlist-write-snapshot'
import { beginPlaylistSongConfirmation } from './playlist-song-outcomes'

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
  setStage?: (stage: SyncStage) => void
  log: (level: 'warn' | 'error', message: string) => void
  onProgress?: (value: PlaylistWriteProgress) => void
}

interface PureSourceReorderResult {
  checkpoint: SourceConvergenceCheckpoint
  plexPlaylist: { ratingKey: string }
  verifiedPlaylistItems: PlaylistAlignmentValidationInput['playlistItems']
}

/**
 * Apply the cache-backed reorder shortcut behind the same identity lock,
 * readback validation and failure projection on every caller.
 *
 * Returns null when cached identities cannot prove the complete target order;
 * the caller must then continue through full Source Convergence.
 */
export async function tryApplyPureSourceReorder(input: PureSourceReorderInput): Promise<PureSourceReorderResult | null> {
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
    setStage,
    log,
  } = input
  if (!source.plexPlaylistRatingKey || pendingPlaylistWrite(source.id)) return null

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
  const sectionKey = (await getSectionKey(config.plex.section)) ?? ''
  if (!sectionKey || [...identityBindings.values()].some(binding => binding.plexSectionKey !== sectionKey)) return null
  const claimed = new Map<string, number>()
  for (const [songId, ratingKey] of cacheKeys) {
    if (conflictingLookupOwner(songId, ratingKey, claimed, identityBindings) !== undefined) return null
    claimed.set(ratingKey, songId)
  }
  const playlist = await getPlaylistByRatingKey(source.plexPlaylistRatingKey)
  if (!playlist) return null
  if (!isWritableAudioPlaylist(playlist)) return null
  const snapshotTracks = await getPlaylistWriteTracks(playlist.ratingKey)
  const snapshotByKey = new Map(snapshotTracks.map(track => [String(track.ratingKey), track]))
  const missingKeys = [...new Set(cacheKeys.values())].filter(key => !snapshotByKey.has(key))
  const missingTracks = await getTracksByRatingKeys(missingKeys)
  missingTracks.forEach((track, key) => snapshotByKey.set(key, track))
  const cacheValidation = await validateCachedTargetOrder(songs, cacheKeys,
    async key => snapshotByKey.get(key) ?? null, bindingPaths, config)
  const targetOrder = cacheValidation.targetOrder
  if (!targetOrder) {
    log('warn', `歌单「${source.name || source.neteasePlaylistName}」纯重排缓存未通过校验，回退到完整对比`)
    return null
  }

  const currentItems = playlistWriteItems(snapshotTracks)
  const remainingTargets = new Set(targetOrder)
  if (currentItems.some(item => !remainingTargets.delete(item.ratingKey))) return null

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

  const result: PureSourceReorderResult = { plexPlaylist: playlist,
    checkpoint: captureSourceConvergenceCheckpoint(currentIdOrder), verifiedPlaylistItems: [] }
  if (dryRun) return result
  const outcomes = beginPlaylistSongConfirmation(job, source.id)

  setStage?.('refreshing_plex')

  const reorderStep = job.startStep('reorder', '重排 Plex 歌单', { context: stepContext })
  setStage?.('updating_plex_playlist')
  let releaseIdentityLock: (() => void) | null = null

  try {
    releaseIdentityLock = await acquireIdentityMutationLock()
    assertBindingVersionsUnchanged(bindingVersionSnapshot)
    const currentBindings = getActiveSongIdentityBindings(currentIdOrder)
    const owner = {
      sourceId: source.id, scope: playlistServerScope(config),
      assertCurrent: () => {
        throwIfCancelled()
        assertPlaylistWriteContext(source, config)
        assertBindingVersionsUnchanged(bindingVersionSnapshot)
        const latest = getActiveSongIdentityBindings(currentIdOrder)
        for (const [songId, ratingKey] of cacheKeys) {
          if (latest.get(songId)?.plexRatingKey !== ratingKey) {
            throw new Error(`歌曲 #${songId} 的身份已变化，本轮已中止旧身份的 Plex 重排`)
          }
        }
      },
      ...playlistIdentityValidator(currentBindings, config),
    }
    owner.assertCurrent()
    for (const [songId, ratingKey] of cacheKeys) {
      if (currentBindings.get(songId)?.plexRatingKey !== ratingKey) {
        throw new Error(`歌曲 #${songId} 的身份已变化，本轮已安全中止 Plex 重排，请重试同步`)
      }
    }
    const reorderResult = await applyFullReorder(
      playlist.ratingKey,
      targetOrder,
      currentItems,
      sectionKey,
      isCancellationRequested,
      (level, message) => log(level, message),
      { owner, removalProtectionReason: '纯重排快捷路径不执行删除', onProgress: value => {
        job.updateStepProgress(reorderStep, value)
        input.onProgress?.(value)
      } },
    )
    const postPlaylistTracks = await getPlaylistWriteTracks(playlist.ratingKey)
    owner.assertCurrent()
    owner.validateTracks(postPlaylistTracks)
    const postItems = playlistWriteItems(postPlaylistTracks)
    const orderValidation = validatePlaylistOrder(targetOrder, postItems, { allowExtra: false })
    if (!orderValidation.ok) {
      throw createPlaylistOrderError(orderValidation, postItems, reorderResult)
    }
    recordAppliedPlexPlaylistFingerprint(
      source.id,
      buildPlexPlaylistFingerprint(postPlaylistTracks),
      undefined,
      buildPlexPathSnapshot(postPlaylistTracks),
    )
    result.verifiedPlaylistItems = postPlaylistTracks.map(track => ({ ratingKey: track.ratingKey,
      plexFilePaths: track.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? []) ?? [] }))
    result.checkpoint = captureSourceConvergenceCheckpoint(currentIdOrder)
    outcomes.confirm(job.getRun().songs.filter(song => song.sourceId === source.id).map(song => song.id))
    const completionMessage = songs.length > targetOrder.length
      ? `Plex 歌单重排完成，${songs.length} 首来源歌曲对应 ${targetOrder.length} 个 Plex 媒体`
      : 'Plex 歌单重排完成'
    job.finishStep(reorderStep, 'success', `${completionMessage}；新增 ${reorderResult.inserted} 项，调序 ${reorderResult.moved} 项`)
  } catch (error) {
    if (error instanceof PlexReorderError) {
      const ratingKeyToSongIds = new Map<string, string[]>()
      for (const [index, song] of songs.entries()) {
        const ratingKey = cacheKeys.get(song.id)!
        const taskSongId = job.findSongIdByIndex(source.id, index)
        if (taskSongId) {
          const songIds = ratingKeyToSongIds.get(ratingKey) ?? []
          songIds.push(taskSongId)
          ratingKeyToSongIds.set(ratingKey, songIds)
        }
      }
      markPlexReorderFailures(job, error.result.failures, {
        ratingKeyToSongIds,
        playlistItemIdToRatingKey: new Map(
          currentItems.map(item => [item.playlistItemId, item.ratingKey]),
        ),
      })
      job.failStep(reorderStep, 'Plex 歌单重排失败', buildPlexReorderStepError(error))
    }
    outcomes.defer(error)
    throw error
  } finally {
    releaseIdentityLock?.()
  }

  throwIfCancelled()
  return result
}
