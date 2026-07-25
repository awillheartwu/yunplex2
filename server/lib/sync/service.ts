import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, fetchPlaylistSongs, fetchAlbumSongs, clearAlbumCache, setArtistAliases } from '../netease'
import { configureResolver } from './artist-resolver'
import { getPlaylistTracks, getPlaylistUpdatedAt, getPlaylistSnapshotByRatingKey, initPlexClient, findPlaylist, getPlaylistByRatingKey, getSectionKey, getTrackByRatingKey } from '../plex-client'
import { RunBuilder } from '../run/builder'
import { cleanupOldRuns, saveSyncRun } from '../run/store'
import type { SongStatus } from '../job/types'
import {
  getEnabledSources,
  listSources,
  recordAppliedPlexPlaylistFingerprint,
  recordSourceComparison,
  recordSourceObservation,
  updateSource,
} from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { buildDownloadTaskIdempotencyKey, enqueueTask, processAll, cleanupOldDownloadTasks, getDownloadTask } from '../download/queue'
import type { DownloadTask } from '../download/queue'
import { downloadSingleSong } from '../download/single-song'
import { emitEvent } from './events'
import { reconcileSource, triggerRescan, findTrackWithRetryDetailed, applyFullReorder } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'
import { deleteSongLookup, deleteUnboundSongLookups } from './song-lookup-store'
import {
  getActiveSongIdentityBindings,
  getSongIdentityBindingByRatingKey,
  normalizePlexPath,
  upsertVerifiedSongIdentityBinding,
} from './identity-store'
import {
  listPlaylistSourceTrackOccurrences,
  observePlaylistSourceTracks,
  recordPlaylistOccurrenceSyncResult,
} from './match-management-store'
import {
  acquireIdentityMutationLock,
  assertBindingVersionsUnchanged,
  captureBindingVersions,
} from './identity-coordinator'
import { validateCachedTargetOrder } from './reorder-cache'
import { recordActivityEvent } from '../activity/store'
import { getFailureMemoryEntry, inferFailurePhase, parseFailureMemory, recordFailure, removeFailures, serializeFailureMemory, shouldSkipSongDueToFailure } from './failure-memory'
import { describePlexMatchFailure, inferPlexMatchFailureCause } from './plex-match'
import { classifyDownloadTaskFailure, shouldAttemptPlexRetryForResolution } from './download-diagnostics'
import { resolveAccessibleLocalPath } from './path-map'
import { CancellationError, createInitialState, STAGE_LABELS, type SyncRunOptions } from './service-state'
import { buildSyncRunSummary, recordSyncRunCompletion } from './service-summary'
import { PlexReorderError, validatePlaylistOrder, type ReorderMutation } from './reorder'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'
import {
  buildReconciliationPlan,
  buildStrongTargetOrder,
  findExtraPlaylistOccurrences,
} from './reconciliation-plan'
import {
  buildExtraTrackObservationKey,
  getExtraTrackObservationCounts,
  markExtraTrackObservationsRemoved,
  observeExtraTracks,
} from './extra-track-observation-store'
import {
  buildNeteasePlaylistCursor,
  buildPlexPlaylistFingerprint,
  classifyPlexPlaylistObservation,
} from './playlist-fingerprint'
import { resolvePlexIdentityPath } from './identity-normalization'
import { getLocalMediaAsset } from './local-media-store'
import { decideRedownload } from './redownload-policy'

export { STAGE_LABELS } from './service-state'

function sameLocalFilePath(first: string, second: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return normalize(first) === normalize(second)
}

export function getSyncService(dataDir: string, getConfig: () => AppConfig) {
  let state = createInitialState()
  let cancelRequested = false
  let currentSourceName = ''
  let currentRun: RunBuilder | null = null

  function getState(): SyncState { return { ...state } }

  function throwIfCancelled(): void {
    if (!cancelRequested) return
    state.currentStage = 'cancelled'
    throw new CancellationError()
  }

  function log(level: 'info' | 'warn' | 'error', message: string, detail?: string) {
    const cfg = getConfig()
    const entry = appendLog(dataDir, { level, message, detail, stage: state.currentStage }, cfg.sync.logRetentionDays ?? 30)
    emitEvent({
      type: 'log',
      data: { id: entry.id, level, message, detail, stage: entry.stage, timestamp: entry.timestamp },
      timestamp: entry.timestamp,
    })
  }

  async function runSync(options?: SyncRunOptions, preparedJob?: RunBuilder): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')

    clearAlbumCache()

    const dryRun = options?.dryRun ?? false
    const targetIds = options?.sourceIds
    const rebuildMatch = options?.rebuildMatch ?? false
    const redownloadAll = options?.redownloadAll ?? false
    const takeOverExternal = options?.takeOverExternal ?? false
    cancelRequested = false
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = preparedJob ?? new RunBuilder(dryRun)
    currentRun = job
    saveSyncRun(job.getRun(), options?.trigger || 'system')

    try {
      const cfg = getConfig()
      const cleanedRuns = cleanupOldRuns(cfg.sync.jobRetentionSuccessDays ?? 7, cfg.sync.jobRetentionFailedDays ?? 90)
      const cleanedTasks = cleanupOldDownloadTasks(cfg.sync.downloadTaskRetentionDays ?? 30)
      if (cleanedRuns > 0 || cleanedTasks > 0) {
        const parts: string[] = []
        if (cleanedRuns > 0) parts.push(`${cleanedRuns} 条旧运行`)
        if (cleanedTasks > 0) parts.push(`${cleanedTasks} 条下载队列`)
        log('info', `清理过期数据: ${parts.join('、')}`)
      }
      const multiFormat = cfg.other?.multiArtistFormat ?? 'ampersand'
      setArtistAliases(cfg.other?.artistAliases ?? {}, cfg.other?.applyAliasToAlbum ?? false)
      configureResolver({
        manualAliases: cfg.other?.artistAliases ?? {},
        enableMB: cfg.other?.enableMusicBrainzResolver ?? true,
        mbMinScore: cfg.other?.musicBrainzMinScore ?? 90,
      })
      const splitArtists = createSplitArtists(multiFormat)

      // ── Validate ──
      if (!cfg.netease.cookie) throw new Error('未配置网易云 Cookie')
      if (!cfg.plex.server || !cfg.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')

      const allSources = getEnabledSources()
      const sources = targetIds
        ? listSources().filter((s) => targetIds.includes(s.id)) // manual trigger: include disabled (e.g. albums)
        : allSources
      if (sources.length === 0) throw new Error('没有可同步的歌单源，请在「歌单源」页面添加')
      job.setSourceIds(sources.map(source => source.id))
      saveSyncRun(job.getRun())

      // ── Sync each source ──
      let totalFailed = 0
      let successfulSources = 0
      let partialSources = 0
      let failedSources = 0

      for (const source of sources) {
        throwIfCancelled()
        currentSourceName = source.name || `网易云歌单 #${source.neteasePlaylistId}`
        const rawLimit = source.syncLimit ?? cfg.sync.songLimit
        const sourceSongLimit = rawLimit === 0 ? undefined : rawLimit
        const playlistId = source.neteasePlaylistId
        const playlistName = currentSourceName
        const isAlbum = source.type === 'album'
        const skipPlexPL = isAlbum && (source.skipPlexPlaylist || cfg.sync.skipPlexPlaylist)
        const skipRemoveExtra = source.skipRemoveExtraTracks || cfg.sync.skipRemoveExtraTracks
        const stepContext = {
          sourceId: source.id,
          sourceName: playlistName,
          sourceType: source.type,
          playlistName,
          plexPlaylistName: source.plexPlaylistName || source.neteasePlaylistName || playlistName,
          plexPlaylistRatingKey: source.plexPlaylistRatingKey || undefined,
          neteasePlaylistId: playlistId,
        }

        job.setConfig({
          playlistId,
          quality: cfg.netease.quality,
          server: cfg.plex.server,
          section: cfg.plex.section,
        })

        try {
          // ── Step 1: Fetch playlist ──
          const s1 = job.startStep('fetch_playlist', `获取${isAlbum ? '专辑' : '歌单'}: ${playlistName}`, {
            context: stepContext,
          })
          setStage('fetching_playlist')
          log('info', `获取${isAlbum ? '专辑' : '歌单'}: ${playlistName} (ID: ${playlistId})`)

          const cookieCheck = await checkCookie(cfg.netease.cookie)
          if (!cookieCheck.valid) {
            const err = { title: 'Cookie 验证失败', message: '网易云 Cookie 已失效，请重新获取并更新配置', stage: 'fetch_playlist' }
            job.failStep(s1, 'Cookie 验证失败', err)
            throw new Error(err.message)
          }

          const { songs: yunSongs, trackUpdateTime: rawTrackUpdateTime, trackIds, allTrackIds, playlistName: nePlaylistName } = source.type === 'album'
            ? { songs: await fetchAlbumSongs(playlistId, cfg.netease.cookie), trackUpdateTime: null, trackIds: [], allTrackIds: [], playlistName: source.neteasePlaylistName }
            : await fetchPlaylistSongs(playlistId, sourceSongLimit, cfg.netease.cookie)
          throwIfCancelled()
          const trackUpdateTime = rawTrackUpdateTime

          // Detect Netease playlist rename
          if (nePlaylistName && nePlaylistName !== source.neteasePlaylistName) {
            log('info', `歌单名称已更改: 「${source.neteasePlaylistName}」→「${nePlaylistName}」`)
            if (!dryRun) updateSource(source.id, { neteasePlaylistName: nePlaylistName })
            source.neteasePlaylistName = nePlaylistName
          }

          const currentIdOrder = isAlbum ? yunSongs.map(song => song.id) : trackIds.map(track => track.id)
          const completeIdOrder = isAlbum ? currentIdOrder : allTrackIds.map(track => track.id)
          if (!dryRun) {
            // Membership is authoritative as soon as the complete NetEase ID
            // list is fetched. Later download/Plex failures must not make the
            // management overview stale or erase a newly added target.
            observePlaylistSourceTracks({
              sourceId: source.id,
              runId: job.getId(),
              managedSongs: yunSongs,
              managedSongIds: currentIdOrder,
              allSongIds: completeIdOrder,
            })
          }
          const resolvedSongIds = new Set(yunSongs.map(song => song.id))
          const missingSongDetailIds = currentIdOrder.filter(songId => !resolvedSongIds.has(songId))
          const authoritativeTrackCount = currentIdOrder.length
          if (missingSongDetailIds.length > 0) {
            log('warn', `网易云歌单返回 ${authoritativeTrackCount} 个 trackId，但 ${missingSongDetailIds.length} 首缺少歌曲详情；这些目标已进入删除保护`)
          }
          const neteaseCursor = buildNeteasePlaylistCursor({
            trackIds: currentIdOrder,
            trackUpdateTime,
          })
          let plexUpdatedAt: number | null = null
          let observedPlexFingerprint: string | null = null
          let plexObservationKind: ReturnType<typeof classifyPlexPlaylistObservation> = 'initial'
          if (source.plexPlaylistRatingKey) {
            await initPlexClient(cfg.plex)
            const staleRatingKey = source.plexPlaylistRatingKey
            const snapshot = await getPlaylistSnapshotByRatingKey(staleRatingKey, 99999)
            if (snapshot) {
              plexUpdatedAt = snapshot.updatedAt
              observedPlexFingerprint = buildPlexPlaylistFingerprint(snapshot.tracks)
              plexObservationKind = classifyPlexPlaylistObservation(observedPlexFingerprint, {
                lastObservedPlexFingerprint: source.lastObservedPlexFingerprint,
                lastAppliedPlexFingerprint: source.lastAppliedPlexFingerprint,
              })
            } else {
              log('warn', `Plex 目标歌单已被删除（旧 ID: ${staleRatingKey}），本轮将按同步源配置重新查找或创建`)
              // Clear every field derived from the deleted Plex playlist. The
              // in-memory mutation forces this run through full reconciliation;
              // persistence ensures a failed recreation never retries the stale
              // ratingKey on the next run.
              source.plexPlaylistRatingKey = ''
              source.plexUpdatedAt = null
              source.lastObservedPlexFingerprint = null
              source.lastAppliedPlexFingerprint = null
              source.requiresMatchReconcile = true
              stepContext.plexPlaylistRatingKey = undefined
              if (!dryRun) {
                updateSource(source.id, {
                  plexPlaylistRatingKey: '',
                  plexUpdatedAt: null,
                  lastObservedPlexFingerprint: null,
                  lastAppliedPlexFingerprint: null,
                  requiresMatchReconcile: true,
                })
              }
            }
          }

          if (!dryRun) {
            recordSourceObservation(source.id, {
              neteaseCursor,
              plexFingerprint: observedPlexFingerprint,
            })
          }

          const currentSnapshotAlreadyCompared = source.lastComparedNeteaseCursor === neteaseCursor
          const emptyTargetConfirmed = authoritativeTrackCount > 0
            || (
              source.lastObservedNeteaseCursor === neteaseCursor
              && source.lastComparedNeteaseCursor === neteaseCursor
            )
          const legacyTimestampDrift = plexObservationKind === 'initial'
            && typeof plexUpdatedAt === 'number'
            && typeof source.plexUpdatedAt === 'number'
            && plexUpdatedAt > source.plexUpdatedAt
            && trackUpdateTime === source.lastTrackUpdateTime
          const plexDriftDetected = !isAlbum
            && !dryRun
            && cfg.sync.reconcileOnPlexDrift !== false
            && Boolean(source.plexPlaylistRatingKey)
            && (plexObservationKind === 'external_change' || legacyTimestampDrift)
            && (currentSnapshotAlreadyCompared || legacyTimestampDrift)
          const det = detectChanges({
            isAlbum,
            trackUpdateTime,
            lastTrackUpdateTime: currentSnapshotAlreadyCompared ? trackUpdateTime : source.lastTrackUpdateTime,
            manualForce: rebuildMatch || redownloadAll || options?.forceFull || cfg.sync.forceFullCompare || source.forceFullCompare || source.requiresMatchReconcile || false,
            dryRun,
            consecutiveSkips: source.consecutiveSkips || 0,
            fullCompareAfterSkips: source.fullCompareAfterSkips ?? cfg.sync.fullCompareAfterSkips,
            fullCompareAfterDays: source.fullCompareAfterDays ?? cfg.sync.fullCompareAfterDays,
            lastFullCompareAt: source.lastFullCompareAt,
            currentIdOrder,
            trackIdSnapshot: source.trackIdSnapshot,
            plexDriftDetected,
          })
          const retryUnresolvedSnapshot = det.skipEntirely
            && (source.lastStatus === 'partial' || source.lastStatus === 'failed')

          job.finishStep(
            s1,
            missingSongDetailIds.length > 0 ? 'partial' : 'success',
            `歌单获取完成，共 ${authoritativeTrackCount} 个目标${missingSongDetailIds.length > 0 ? `，${missingSongDetailIds.length} 首缺少详情` : ''}（${det.changedMsg}${det.diffMsg ? '，' + det.diffMsg : ''}）`,
          )

          if (rebuildMatch && !dryRun) {
            log('info', `歌单「${playlistName}」将先实时验证旧路径并迁移可用身份，再清理未绑定的查找缓存`)
          }

          // Skip entirely if Netease unchanged
          if (
            det.skipEntirely
            && !retryUnresolvedSnapshot
            && missingSongDetailIds.length === 0
            && !(authoritativeTrackCount === 0 && source.lastStatus !== 'success')
          ) {
            log('info', `歌单「${playlistName}」未变化，跳过对比（连续跳过 ${(source.consecutiveSkips || 0) + 1} 次）`)
            const unchangedStatus = source.lastStatus === 'idle' ? 'success' : source.lastStatus
            updateSource(source.id, {
              lastSyncedAt: new Date().toISOString(), lastStatus: unchangedStatus, lastError: source.lastError,
              lastJobId: job.getId(), trackCount: authoritativeTrackCount,
              lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt,
              consecutiveSkips: (source.consecutiveSkips || 0) + 1,
            })
            recordActivityEvent({
              domain: 'sync',
              type: 'source_sync_skipped_unchanged',
              severity: 'info',
              title: `跳过“${playlistName}”同步`,
              summary: `检测到内容未变化，已连续跳过 ${(source.consecutiveSkips || 0) + 1} 次。`,
              context: { sourceId: source.id, sourceName: playlistName, jobId: job.getId() },
              link: `/task-center/runs/${job.getId()}`,
              groupKey: `job:${job.getId()}:source:${source.id}`,
            })
            if (unchangedStatus === 'success') successfulSources++
            else if (unchangedStatus === 'partial') partialSources++
            else failedSources++
            continue
          }

          if (retryUnresolvedSnapshot) {
            log('info', `歌单「${playlistName}」内容未变，但上次尚未收敛；本轮只做身份复核和一次 Plex 精确路径探测`)
          }

          if (det.autoForce) log('info', `歌单「${playlistName}」触发自动全量对比（超过${cfg.sync.fullCompareAfterSkips > 0 ? '跳过次数' : '时间间隔'}）`)
          if (det.plexDriftDetected) log('info', `歌单「${playlistName}」检测到 Plex 侧更新，触发全量对齐`)

          // Pure reorder: skip download, just reorder Plex playlist
          if (det.isPureReorder && !det.needFullCompare && missingSongDetailIds.length === 0) {
            log('info', `歌单「${playlistName}」仅顺序变化，跳过下载直接重排`)
            const identityBindings = getActiveSongIdentityBindings(currentIdOrder)
            const cacheKeys = new Map([...identityBindings].flatMap(([songId, binding]) => binding.plexRatingKey ? [[songId, binding.plexRatingKey] as const] : []))
            const bindingPaths = new Map([...identityBindings].map(([songId, binding]) => [
              songId,
              resolvePlexIdentityPath({
                relativePath: binding.plexRelativePath,
                currentSectionRoot: cfg.download.plexLibraryPathPrefix,
                lastObservedPath: binding.plexFilePath,
              }),
            ]))
            await initPlexClient(cfg.plex)
            const cacheValidation = await validateCachedTargetOrder(yunSongs, cacheKeys, undefined, bindingPaths)
            for (const issue of cacheValidation.issues) {
              if (issue.reason !== 'missing_cache') deleteSongLookup(issue.songId)
            }
            const targetOrder = cacheValidation.targetOrder
            if (!targetOrder) {
              log('warn', `歌单「${playlistName}」纯重排缓存未通过校验，回退到完整对比`)
            } else {
              const allSongs = yunSongs.map((s, neteaseIndex) => ({
                songName: s.name,
                artist: joinArtist(s.artists),
                album: s.album.name,
                status: 'skipped_existing' as SongStatus,
                neteaseSongId: s.id,
                neteaseIndex,
              }))
              job.addSongs(source.id, allSongs)
              for (const s of job.getRun().songs) {
                if (s.sourceId === source.id) job.updateSong(s.id, { status: 'skipped_existing', phase: 'done' })
              }
              // Quick-resolve Plex playlist for reorder
              if (!dryRun) {
                await initPlexClient(cfg.plex)
                let pp = source.plexPlaylistRatingKey ? await getPlaylistByRatingKey(source.plexPlaylistRatingKey) : null
                if (!pp) { const pn = source.plexPlaylistName || source.neteasePlaylistName; pp = await findPlaylist(pn) }
                if (pp) {
                  const sk = (await getSectionKey(cfg.plex.section)) ?? ''
                  const currentItems = (await getPlaylistTracks(pp.ratingKey, 99999)).filter(t => t.playlistItemID).map(t => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))
                  const reorderStep = job.startStep('reorder', '重排 Plex 歌单', { context: stepContext })
                  let releaseIdentityLock: (() => void) | null = null
                  try {
                    releaseIdentityLock = await acquireIdentityMutationLock()
                    const currentBindings = getActiveSongIdentityBindings(currentIdOrder)
                    for (const [songId, ratingKey] of cacheKeys) {
                      if (currentBindings.get(songId)?.plexRatingKey !== ratingKey) {
                        throw new Error(`歌曲 #${songId} 的身份已变化，本轮已安全中止 Plex 重排，请重试同步`)
                      }
                    }
                    await applyFullReorder(
                      pp.ratingKey,
                      targetOrder,
                      currentItems,
                      sk,
                      () => cancelRequested,
                      (lvl, msg) => log(lvl as 'info'|'warn'|'error', msg),
                      { removalProtectionReason: '纯重排快捷路径不执行删除' },
                    )
                    const postPlaylistTracks = await getPlaylistTracks(pp.ratingKey, 99999)
                    const postItems = postPlaylistTracks
                      .filter(t => t.playlistItemID)
                      .map(t => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))
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
                  } catch (err) {
                    if (err instanceof PlexReorderError) {
                      const ratingKeyToSongId = new Map<string, string>()
                      for (const [neteaseSongId, ratingKey] of cacheKeys) {
                        const taskSongId = job.findSongId(source.id, neteaseSongId)
                        if (taskSongId) ratingKeyToSongId.set(ratingKey, taskSongId)
                      }
                      markPlexReorderFailures(job, err.result.failures, {
                        ratingKeyToSongId,
                        playlistItemIdToRatingKey: new Map(currentItems.map(item => [item.playlistItemId, item.ratingKey])),
                      })
                      job.failStep(reorderStep, 'Plex 歌单重排失败', buildPlexReorderStepError(err))
                    }
                    throw err
                  } finally {
                    releaseIdentityLock?.()
                  }
                  throwIfCancelled()
                }
              }
              if (!dryRun) {
                recordSourceComparison(source.id, {
                  neteaseCursor,
                })
              }
              if (!dryRun) updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null, lastJobId: job.getId(), trackCount: authoritativeTrackCount, lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt, consecutiveSkips: 0, lastFullCompareAt: new Date().toISOString(), trackIdSnapshot: JSON.stringify(currentIdOrder), requiresMatchReconcile: false })
              successfulSources++
              continue
            }
          }

          // Register all songs to job
          const allSongs = yunSongs.map((s, neteaseIndex) => ({
            songName: s.name,
            artist: joinArtist(s.artists),
            album: s.album.name,
            status: 'pending' as SongStatus,
            neteaseSongId: s.id,
            neteaseIndex,
          }))
          job.addSongs(source.id, allSongs)
          for (const missingSongId of missingSongDetailIds) {
            const [taskSongId] = job.addSongs(source.id, [{
              songName: `网易云歌曲 #${missingSongId}`,
              artist: '详情未返回',
              album: '未知专辑',
              status: 'match_pending_review',
              neteaseSongId: missingSongId,
            }])
            if (taskSongId) {
              job.updateSong(taskSongId, {
                phase: 'done',
                metadata: {
                  matchTrace: {
                    source: 'pending_review',
                    decision: 'preserved',
                    deletionProtectionReason: '网易云 song_detail 未返回该 trackId，无法安全判断身份',
                  },
                },
              })
            }
          }
          // ── Step 2a: Load download retry policy without removing target identities ──
          // Copyright/failure memory is allowed to suppress another download,
          // but it must never remove a desired song from reconciliation. If it
          // disappeared here, an existing Plex occurrence could be classified
          // as extra and deleted simply because a previous download failed.
          const knownRestricted: number[] = source.copyrightRestrictedIds
            ? JSON.parse(source.copyrightRestrictedIds)
            : []
          const failureMemory = parseFailureMemory(source.ignoredFailureIds)
          const maxFailures = cfg.sync.maxFailureAttempts

          // ── Step 2b: Reconcile (tiered lookup: DB → Plex → disk → download) ──
          setStage('comparing')
          log('info', '连接 Plex...')

          const { resolutions, plexPlaylist: plexPlaylistResult, sectionKey, extraTracks } = await reconcileSource(
            source, yunSongs, cfg, job, splitArtists,
            () => cancelRequested,
            (lvl, msg) => log(lvl as 'info' | 'warn' | 'error', msg),
            skipPlexPL,
            dryRun,
          )
          throwIfCancelled()
          const bindingVersionSnapshot = captureBindingVersions(currentIdOrder)
          const plexPlaylist = plexPlaylistResult
          const findResolutionTaskId = (resolution: (typeof resolutions)[number]) =>
            job.findSongIdByIndex(source.id, resolution.neteaseIndex)
              ?? job.findSongId(source.id, resolution.song.id)
          const getResolutionTask = (resolution: (typeof resolutions)[number]) =>
            job.getSongByIndex(source.id, resolution.neteaseIndex)
              ?? job.getSong(source.id, resolution.song.id)

          if (!dryRun) {
            recordSourceComparison(source.id, {
              neteaseCursor,
              plexFingerprint: observedPlexFingerprint,
            })
          }

          if (rebuildMatch && !dryRun) {
            const removed = deleteUnboundSongLookups(currentIdOrder)
            log('info', `歌单「${playlistName}」已保留经实时验证的身份，并清理 ${removed} 条未绑定查找缓存`)
          }

          // Apply failure memory only after Plex/path/identity lookup. A song
          // already present in Plex remains a normal target even when a past
          // download attempt was restricted or exhausted.
          for (const r of resolutions) {
            if (r.plexRatingKey || !['needs_download', 'unavailable'].includes(r.resolution)) continue
            if (redownloadAll) continue
            if (knownRestricted.includes(r.song.id)) {
              r.resolution = 'copyright_restricted'
              continue
            }
            if (shouldSkipSongDueToFailure(failureMemory, r.song.id, maxFailures)) {
              r.resolution = 'ignored_failure'
            }
          }

          // Update job song statuses from TrackResolution results
          for (const r of resolutions) {
            const songId = findResolutionTaskId(r)
            if (!songId) continue
            if (r.matchTrace) {
              job.updateSong(songId, { metadata: { matchTrace: { ...r.matchTrace } } })
            }
            if (r.resolution === 'matched_plex_playlist' || r.resolution === 'found_in_plex_library') {
              job.updateSong(songId, { status: 'skipped_existing', phase: 'done' })
            } else if (r.resolution === 'needs_review') {
              job.updateSong(songId, { status: 'match_pending_review', phase: 'plex_match' })
            } else if (r.resolution === 'unavailable') {
              job.updateSong(songId, { status: 'failed_download', phase: 'download', error: { title: '歌曲不可用', message: '网易云无下载链接', stage: 'download', songName: r.song.name, artist: splitArtists(r.song.artists)[0] } })
            } else if (r.resolution === 'copyright_restricted') {
              job.updateSong(songId, { status: 'copyright_restricted', phase: 'download' })
            } else if (r.resolution === 'ignored_failure') {
              const entry = getFailureMemoryEntry(failureMemory, r.song.id)
              job.updateSong(songId, { status: 'ignored_failure', phase: inferFailurePhase(r.song.id, entry) })
            }
            // needs_download / found_on_disk stay pending
          }

          // Register concrete Plex extra occurrences as preserved by default.
          // Their status changes to "removed" only after Plex confirms the
          // occurrence-level deletion. This prevents run history from claiming
          // a removal that was merely planned or later safety-blocked.
          const extraTaskIds = new Map<number, string>()
          if (!skipRemoveExtra) {
            for (const xt of extraTracks) {
              const extraTaskId = job.addExtraSong(source.id, {
                songName: xt.title,
                artist: xt.artist,
                album: xt.album,
                ratingKey: xt.ratingKey,
                playlistItemId: xt.playlistItemId,
                status: 'extra_skipped',
              })
              extraTaskIds.set(xt.playlistItemId, extraTaskId)
              job.updateSong(extraTaskId, {
                phase: 'done',
                metadata: {
                  plexRatingKey: xt.ratingKey,
                  plexPlaylistItemId: xt.playlistItemId,
                  matchTrace: {
                    decision: 'preserved',
                    deletionProtectionReason: xt.protectionReason,
                    relatedNeteaseSongId: xt.relatedNeteaseSongId,
                    reviewId: xt.relatedReviewId,
                  },
                },
              })
            }
          }

          // ── Step 3: Collect songs needing download (caches already applied in Step 2a) ──
          const downloadPlans = new Map<number, {
            resolution: (typeof resolutions)[number]
            mode: 'full' | 'replace'
            audioPath?: string
          }>()
          for (const resolution of resolutions) {
            if (resolution.resolution === 'needs_download' && !downloadPlans.has(resolution.song.id)) {
              downloadPlans.set(resolution.song.id, { resolution, mode: 'full' })
            }
          }

          if (redownloadAll) {
            const bindings = getActiveSongIdentityBindings(resolutions.map(item => item.song.id))
            const skipped = { external: 0, manual: 0 }
            for (const resolution of resolutions) {
              if (downloadPlans.get(resolution.song.id)?.mode === 'replace') continue
              const decision = decideRedownload({
                asset: getLocalMediaAsset(resolution.song.id),
                binding: bindings.get(resolution.song.id) ?? null,
                takeOverExternal,
              })
              if (!decision.eligible) {
                if (decision.disposition === 'skip_external') skipped.external++
                if (decision.disposition === 'skip_manual_binding') skipped.manual++
                continue
              }
              downloadPlans.set(resolution.song.id, {
                resolution,
                mode: 'replace',
                audioPath: decision.audioPath,
              })
            }
            log(
              'info',
              `强制重新下载计划：${downloadPlans.size} 首；保护跳过外部文件 ${skipped.external} 首、人工绑定 ${skipped.manual} 首`,
            )
          }

          const songsToDownload = [...downloadPlans.values()].map(plan => plan.resolution)

          const songsOnDisk = resolutions.filter((r) => r.resolution === 'found_on_disk')
          const needsRefresh = songsToDownload.length > 0 || songsOnDisk.length > 0
          const queuedDownloadTasks = new Map<number, DownloadTask>()

          if (!dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', redownloadAll ? '重新下载音频' : '下载歌曲', { context: stepContext })
            setStage('downloading')
            log('info', `开始下载 ${songsToDownload.length} 首歌曲`)

            for (const r of songsToDownload) {
              const [, trackArtist] = splitArtists(r.song.artists)
              const task = enqueueTask({
                sourceId: source.id,
                songId: r.song.id,
                songName: r.song.name,
                artist: trackArtist || splitArtists(r.song.artists)[0],
                album: r.song.album.name,
                quality: cfg.netease.quality,
                jobId: job.getId(),
                idempotencyKey: buildDownloadTaskIdempotencyKey({
                  songId: r.song.id,
                  operation: downloadPlans.get(r.song.id)?.mode === 'replace' ? 'replace' : 'download',
                  quality: cfg.netease.quality,
                  downloadDir: cfg.download.dir,
                  pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
                }),
              })
              queuedDownloadTasks.set(r.song.id, task)
            }

            const processor = async (
              task: DownloadTask,
              onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
              signal: AbortSignal,
            ) => {
              throwIfCancelled()
              const plan = downloadPlans.get(task.songId)
              return downloadSingleSong(task.songId, {
                quality: cfg.netease.quality,
                cookie: cfg.netease.cookie,
                downloadDir: cfg.download.dir,
                pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
                multiArtistFormat: multiFormat,
                downloadLyrics: cfg.download.downloadLyrics,
                embedMetadata: cfg.download.embedMetadata,
                embedCover: cfg.download.embedCover,
                saveAlbumCover: cfg.download.saveAlbumCover ?? false,
                saveArtistImage: cfg.download.saveArtistImage ?? false,
                lyricOrder: (cfg.other?.lyricOrder ?? 'original_first') as 'original_first' | 'translated_first',
                downloadTranslatedLyric: cfg.other?.downloadTranslatedLyric ?? true,
                downloadRomajiLyric: cfg.other?.downloadRomajiLyric ?? false,
                downloadMode: plan?.mode ?? 'full',
                audioPath: plan?.audioPath,
              }, onProgress, signal)
            }

            await processAll(processor, undefined, cfg.sync.downloadConcurrency || 3, [...queuedDownloadTasks.values()].map(task => task.id))
            throwIfCancelled()
            setStage('processing_tags')

            for (const r of songsToDownload) {
              const songId = findResolutionTaskId(r)
              if (!songId) continue

              const queuedTaskId = queuedDownloadTasks.get(r.song.id)?.id
              const task = queuedTaskId ? getDownloadTask(queuedTaskId) : null
              if (!task || task.status === 'failed') {
                const diagnosis = classifyDownloadTaskFailure(task)
                const artist = splitArtists(r.song.artists)[0]
                const resolvedFilePath = task?.filePath ?? r.filePath
                if (resolvedFilePath) r.filePath = resolvedFilePath

                job.updateSong(songId, {
                  status: diagnosis.status,
                  phase: diagnosis.phase,
                  filePath: resolvedFilePath ?? undefined,
                  fileType: task?.fileType ?? undefined,
                  ...(task?.error
                    ? {
                        error: {
                          title: diagnosis.title,
                          message: task.error,
                          stage: diagnosis.phase,
                          songName: r.song.name,
                          artist,
                        },
                      }
                    : {}),
                })
                if (task?.error) {
                  if (diagnosis.status === 'copyright_restricted') {
                    log('warn', `版权受限: ${r.song.name}`, task.error)
                  } else if (diagnosis.status === 'failed_tags') {
                    addFailure(r.song.name, task.error)
                    log('error', `标签写入失败: ${r.song.name}`, task.error)
                  } else {
                    addFailure(r.song.name, task.error)
                    log('error', `下载失败: ${r.song.name}`, task.error)
                  }
                }
              } else if (task.status === 'done') {
                const previousFilePath = r.filePath
                r.filePath = task.filePath ?? r.filePath
                if (
                  downloadPlans.get(r.song.id)?.mode === 'replace'
                  && r.filePath
                  && (!previousFilePath || !sameLocalFilePath(previousFilePath, r.filePath))
                ) {
                  r.resolution = 'found_on_disk'
                  r.plexRatingKey = undefined
                }
                job.updateSong(songId, {
                  status: 'success', phase: 'done',
                  filePath: task.filePath, fileType: task.fileType,
                  metadata: { trackNumber: r.song.no, quality: cfg.netease.quality, duration: r.song.dt, disc: r.song.disc || '1' },
                })
              }
            }

            const okCount = songsToDownload.filter((r) => {
              const js = getResolutionTask(r)
              return js?.status === 'success'
            }).length
            const failCount = songsToDownload.length - okCount
            log('info', `${redownloadAll ? '重新下载' : '下载'}完成: ${okCount} 成功, ${failCount} 失败`)
            job.finishStep(s3, failCount > 0 ? 'partial' : 'success', `${okCount} 首成功，${failCount} 首失败`)
          } else if (dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', redownloadAll ? '重新下载音频' : '下载歌曲', { context: stepContext })
            for (const r of songsToDownload) {
              log('info', `[预览] 将${downloadPlans.get(r.song.id)?.mode === 'replace' ? '重新下载' : '下载'}: ${r.song.name}`)
            }
            job.finishStep(s3, 'success', `[预览] 共 ${songsToDownload.length} 首`)
          }

          // Mark copyright-restricted resolutions (skip Plex retry)
          for (const r of resolutions) {
            if (r.resolution === 'needs_download') {
              const queuedTaskId = queuedDownloadTasks.get(r.song.id)?.id
              const task = queuedTaskId
                ? getDownloadTask(queuedTaskId)
                : null
              const diagnosis = classifyDownloadTaskFailure(task)
              if (task?.filePath && !r.filePath) {
                r.filePath = task.filePath
              }
              if (task?.status === 'failed' && diagnosis.status === 'copyright_restricted') {
                r.resolution = 'copyright_restricted'
              }
            }
          }

          // ── Step 4: Reorder Plex playlist (with retry-based lookup for new tracks) ──
          if (!dryRun && !skipPlexPL) {
            const s4 = job.startStep('reorder', '重排 Plex 歌单', {
              context: {
                ...stepContext,
                plexPlaylistName: plexPlaylist.title || stepContext.plexPlaylistName,
                plexPlaylistRatingKey: plexPlaylist.ratingKey,
                sectionKey,
              },
            })
            setStage('updating_plex_playlist')

            // Trigger Plex scan if needed (fire and forget — we'll retry-search below)
            if (needsRefresh && sectionKey) {
              await triggerRescan(sectionKey)
              throwIfCancelled()
              recordActivityEvent({
                domain: 'plex',
                type: 'plex_library_refresh_requested',
                severity: 'info',
                title: `请求刷新 Plex 媒体库`,
                summary: `“${playlistName}”存在新歌或本地补齐内容，已请求 Plex 扫描。`,
                context: { sourceId: source.id, sourceName: playlistName, jobId: job.getId(), sectionKey },
                link: `/task-center/runs/${job.getId()}`,
                groupKey: `job:${job.getId()}:source:${source.id}`,
              })
            }

            log('info', '开始 Plex 查找重试')
            // Build target order: all resolved tracks with plexRatingKeys
            // For needs_download / found_on_disk, retry-search with backoff
            const plexMatchResults = new Map<number, Awaited<ReturnType<typeof findTrackWithRetryDetailed>>>()
            const failedPlexRetrySongIds: number[] = []

            for (const r of resolutions) {
              throwIfCancelled()
              const sid = findResolutionTaskId(r)
              const currentSong = getResolutionTask(r)
              const effectiveStatus = currentSong?.status
              const effectiveFilePath = currentSong?.filePath ?? r.filePath
              if (effectiveFilePath && !r.filePath) r.filePath = effectiveFilePath

              if (shouldAttemptPlexRetryForResolution(r.resolution, effectiveStatus, effectiveFilePath)) {
                const result = await findTrackWithRetryDetailed(
                  sectionKey,
                  r.song,
                  cfg,
                  effectiveFilePath,
                  retryUnresolvedSnapshot ? 0 : cfg.sync.plexScanRetries,
                  cfg.sync.plexScanRetryDelaySec * 1000,
                )
                if (result.ratingKey) {
                  r.plexRatingKey = result.ratingKey
                  r.resolution = 'found_in_plex_library'
                  // A retry may find the exact file just indexed by Plex. Only
                  // this mapped-path proof is allowed to become durable
                  // identity; a metadata-only retry remains non-destructive.
                  const indexedTrack = await getTrackByRatingKey(result.ratingKey)
                  const indexedPathMatch = indexedTrack?.Media
                    ?.flatMap(media => media.Part ?? [])
                    .flatMap(part => part.file ? [part.file] : [])
                    .map(plexPath => ({ plexPath, localPath: resolveAccessibleLocalPath(plexPath, cfg) }))
                    .find(candidate => candidate.localPath && effectiveFilePath
                      && sameLocalFilePath(candidate.localPath, effectiveFilePath))
                  const indexedPlexPath = indexedPathMatch?.plexPath
                  const indexedLocalPath = indexedPathMatch?.localPath ?? null
                  if (indexedPlexPath && effectiveFilePath && indexedLocalPath && sameLocalFilePath(indexedLocalPath, effectiveFilePath)) {
                    upsertVerifiedSongIdentityBinding({
                      neteaseSongId: r.song.id, plexSectionKey: sectionKey, plexFilePath: indexedPlexPath,
                      plexRatingKey: result.ratingKey, mbRecordingId: null, bindingMethod: 'path', status: 'active',
                      evidence: { source: 'plex_retry_exact_path', matchedBy: result.matchedBy, attempts: result.attempts },
                    })
                    r.matchTrace = {
                      source: 'identity_binding', ratingKey: result.ratingKey, filePath: indexedLocalPath,
                      decision: 'bound', identity: { method: 'path', plexFilePath: normalizePlexPath(indexedPlexPath), bindingStatus: 'active' },
                    }
                    if (sid) job.updateSong(sid, { metadata: { matchTrace: { ...r.matchTrace } } })
                  }
                  if (currentSong?.status === 'pending' && sid) {
                    job.updateSong(sid, {
                      status: 'success',
                      phase: 'done',
                      filePath: effectiveFilePath ?? undefined,
                    })
                  }
                  log('info', `Plex 已索引: ${r.song.name}`)
                } else {
                  plexMatchResults.set(r.song.id, result)
                  failedPlexRetrySongIds.push(r.song.id)
                  log('warn', `Plex 未找到: ${r.song.name}（请手动扫描 Plex）`)
                  if (sid && currentSong?.status !== 'failed_tags') {
                    job.updateSong(sid, { status: 'failed_plex_match', phase: 'plex_match' })
                  }
                }
              }
            }

            for (const r of resolutions) {
              const result = plexMatchResults.get(r.song.id)
              if (!result) continue

              const cause = inferPlexMatchFailureCause(result, {
                downloadedSongs: songsToDownload.length,
                failedDownloadedSongs: failedPlexRetrySongIds.length,
              })
              const sid = findResolutionTaskId(r)
              if (!sid) continue
              const currentSong = getResolutionTask(r)
              if (currentSong?.status === 'failed_tags') continue

              job.updateSong(sid, {
                error: {
                  title: cause === 'library_visibility' ? 'Plex 看不到刚下载的文件' : 'Plex 未匹配到歌曲',
                  message: describePlexMatchFailure(cause, cfg),
                  stage: 'plex_match',
                  songName: r.song.name,
                  artist: splitArtists(r.song.artists)[0],
                  context: {
                    cause,
                    attempts: result.attempts,
                    matchedBy: result.matchedBy,
                    expectedLocalPath: result.localFilePath,
                    traces: result.traces,
                  },
                },
              })
            }

            // Fetch concrete playlist occurrences and build the deletion plan.
            // A durable identity for an item whose Netease song is absent from
            // this target can authorize removal; title/artist similarity cannot.
            const currentPlaylistTracks = (await getPlaylistTracks(plexPlaylist.ratingKey, 99999))
              .filter((track) => track.playlistItemID)
            const currentItems = currentPlaylistTracks.map(track => ({
              ratingKey: track.ratingKey,
              playlistItemId: track.playlistItemID!,
              observationKey: buildExtraTrackObservationKey(
                track.ratingKey,
                (track.Media ?? []).flatMap(media =>
                  media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
                ),
              ),
            }))
            const currentOccurrences = listPlaylistSourceTrackOccurrences(source.id)
            const occurrencesByPreviousRatingKey = new Map<string, typeof currentOccurrences>()
            for (const occurrence of currentOccurrences) {
              if (!occurrence.alignedPlexRatingKey) continue
              const values = occurrencesByPreviousRatingKey.get(occurrence.alignedPlexRatingKey) ?? []
              values.push(occurrence)
              occurrencesByPreviousRatingKey.set(occurrence.alignedPlexRatingKey, values)
            }
            const knownCurrentIdentities = currentItems.flatMap((item) => {
              const binding = getSongIdentityBindingByRatingKey(item.ratingKey)
              if (binding) return [{ neteaseSongId: binding.neteaseSongId, plexRatingKey: binding.plexRatingKey }]
              // A manual rebind intentionally moves the global identity away
              // from the old ratingKey. The occurrence-level readback is the
              // auditable proof that the old playlist item belonged to this
              // same target member. It may authorize replacement only after
              // the new target resolved to a concrete, different ratingKey.
              const previousCandidates = occurrencesByPreviousRatingKey.get(item.ratingKey) ?? []
              const previous = previousCandidates.length === 1 ? previousCandidates[0] : undefined
              const replacement = previous && resolutions.find(resolution =>
                resolution.neteaseIndex === previous.position
                && resolution.song.id === previous.neteaseSongId
                && resolution.plexRatingKey
                && resolution.plexRatingKey !== item.ratingKey,
              )
              return previous && replacement
                ? [{ neteaseSongId: previous.neteaseSongId, plexRatingKey: item.ratingKey }]
                : []
            })
            const reconciliationTargets = resolutions.map(resolution => ({
              neteaseSongId: resolution.song.id,
              plexRatingKey: resolution.plexRatingKey,
              matchTrace: resolution.matchTrace,
            }))
            const strongTargetOrder = buildStrongTargetOrder(reconciliationTargets)
            const targetComplete = strongTargetOrder.length === currentIdOrder.length
            const observedExtraItems = findExtraPlaylistOccurrences(strongTargetOrder, currentItems)
            const observationItems = observedExtraItems.map((item) => {
              const track = currentPlaylistTracks.find(candidate => candidate.playlistItemID === item.playlistItemId)
              const plexFilePath = (track?.Media ?? []).flatMap(media =>
                media.Part?.flatMap(part => part.file ? [normalizePlexPath(part.file)] : []) ?? [],
              ).sort((a, b) => a.localeCompare(b))[0] ?? null
              return {
                identityKey: item.observationKey!,
                ratingKey: item.ratingKey,
                plexFilePath,
              }
            })
            const extraObservationCounts = dryRun
              ? getExtraTrackObservationCounts(source.id, plexPlaylist.ratingKey)
              : observeExtraTracks({
                  sourceId: source.id,
                  playlistRatingKey: plexPlaylist.ratingKey,
                  runId: job.getId(),
                  targetComplete,
                  items: observationItems,
                })
            const reconciliationPlan = buildReconciliationPlan({
              expectedTargetSongIds: currentIdOrder,
              targets: reconciliationTargets,
              currentItems,
              knownCurrentIdentities,
              skipRemoveExtraTracks: skipRemoveExtra,
              allowEmptyRemoval: emptyTargetConfirmed,
              extraTrackRemovalPolicy: cfg.sync.extraTrackRemovalPolicy,
              extraObservationCounts,
            })

            if (reconciliationPlan.hasIncompleteTargetOrder) {
              log('warn', `歌单「${playlistName}」仍有歌曲未建立 Plex 强身份，相关旧项将保留待确认`)
            }

            for (const decision of reconciliationPlan.removalDecisions) {
              let extraSongId = extraTaskIds.get(decision.playlistItemId)
                ?? job.findRemovedSongIdByPlaylistItemId(source.id, decision.playlistItemId)
              if (!extraSongId && !skipRemoveExtra) {
                const track = currentPlaylistTracks.find(item => item.playlistItemID === decision.playlistItemId)
                if (track) {
                  extraSongId = job.addExtraSong(source.id, {
                    songName: track.title,
                    artist: track.grandparentTitle || '',
                    album: track.parentTitle || '',
                    ratingKey: track.ratingKey,
                    playlistItemId: decision.playlistItemId,
                    status: 'extra_skipped',
                  })
                  extraTaskIds.set(decision.playlistItemId, extraSongId)
                }
              }
              if (!extraSongId || decision.action !== 'preserve') continue
              const relatedExtra = extraTracks.find(extra => extra.playlistItemId === decision.playlistItemId)
              job.updateSong(extraSongId, {
                status: 'extra_skipped',
                phase: 'done',
                metadata: {
                  plexRatingKey: decision.ratingKey,
                  plexPlaylistItemId: decision.playlistItemId,
                  matchTrace: {
                    decision: 'preserved',
                    deletionProtectionReason: decision.reason,
                    relatedNeteaseSongId: relatedExtra?.relatedNeteaseSongId,
                    reviewId: relatedExtra?.relatedReviewId,
                  },
                },
              })
            }

            const applyConfirmedReorderMutations = (mutations: readonly ReorderMutation[]) => {
              const removedObservationKeys: string[] = []
              for (const mutation of mutations) {
                if (mutation.action !== 'remove') continue
                const observationKey = currentItems.find(
                  item => item.playlistItemId === mutation.playlistItemId,
                )?.observationKey
                if (observationKey) removedObservationKeys.push(observationKey)
                const extraSongId = extraTaskIds.get(mutation.playlistItemId)
                  ?? job.findRemovedSongIdByPlaylistItemId(source.id, mutation.playlistItemId)
                if (!extraSongId) continue
                job.updateSong(extraSongId, {
                  status: 'removed',
                  phase: 'done',
                  metadata: {
                    plexRatingKey: mutation.ratingKey,
                    plexPlaylistItemId: mutation.playlistItemId,
                    matchTrace: { decision: 'removed' },
                  },
                })
              }
              if (!dryRun && removedObservationKeys.length > 0) {
                markExtraTrackObservationsRemoved(
                  source.id,
                  plexPlaylist.ratingKey,
                  job.getId(),
                  removedObservationKeys,
                )
              }
            }

            let releaseIdentityLock: (() => void) | null = null
            try {
              releaseIdentityLock = await acquireIdentityMutationLock()
              assertBindingVersionsUnchanged(bindingVersionSnapshot)
              const currentBindings = getActiveSongIdentityBindings(currentIdOrder)
              for (const resolution of resolutions) {
                if (!resolution.plexRatingKey) continue
                const binding = currentBindings.get(resolution.song.id)
                if (binding && binding.plexRatingKey !== resolution.plexRatingKey) {
                  throw new Error(`歌曲 #${resolution.song.id} 的身份已变化，本轮已安全中止 Plex 写入和删除，请重试同步`)
                }
              }
              const reorderResult = await applyFullReorder(
                plexPlaylist.ratingKey, reconciliationPlan.targetOrder, currentItems, sectionKey,
                () => cancelRequested,
                (lvl, msg) => log(lvl as 'info' | 'warn' | 'error', msg),
                {
                  authorizedRemovalItemIds: reconciliationPlan.authorizedRemovalItemIds,
                  removalProtectionReason: reconciliationPlan.hasIncompleteTargetOrder
                    ? '目标歌单尚有未建立强身份的歌曲'
                    : '缺少可审计的旧身份',
                },
              )
              applyConfirmedReorderMutations(reorderResult.mutations)
              const postPlaylistTracks = await getPlaylistTracks(plexPlaylist.ratingKey, 99999)
              const postItems = postPlaylistTracks
                .filter((t) => t.playlistItemID)
                .map((t) => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))
              const orderValidation = validatePlaylistOrder(reconciliationPlan.targetOrder, postItems, {
                allowExtra: reconciliationPlan.allowExtra,
              })
              if (!orderValidation.ok) {
                job.failStep(s4, 'Plex 歌单重排校验失败', {
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
            } catch (err) {
              if (err instanceof PlexReorderError) {
                // Earlier removals may already have succeeded before a later
                // occurrence failed. Persist those confirmed mutations so run
                // history reflects Plex reality rather than the final throw.
                applyConfirmedReorderMutations(err.result.mutations)
                const ratingKeyToSongId = new Map<string, string>()
                for (const r of resolutions) {
                  if (!r.plexRatingKey) continue
                  const taskSongId = findResolutionTaskId(r)
                  if (taskSongId) ratingKeyToSongId.set(r.plexRatingKey, taskSongId)
                }

                const playlistItemIdToRemovedSongId = new Map<number, string>()
                for (const item of currentItems) {
                  const removedSongId = extraTaskIds.get(item.playlistItemId)
                    ?? job.findRemovedSongIdByPlaylistItemId(source.id, item.playlistItemId)
                  if (removedSongId) playlistItemIdToRemovedSongId.set(item.playlistItemId, removedSongId)
                }

                markPlexReorderFailures(job, err.result.failures, {
                  ratingKeyToSongId,
                  playlistItemIdToRatingKey: new Map(currentItems.map(item => [item.playlistItemId, item.ratingKey])),
                  playlistItemIdToRemovedSongId,
                })
                job.failStep(s4, 'Plex 歌单重排失败', buildPlexReorderStepError(err))
              }
              // Best-effort observation of any partial app writes. This is not
              // marked as an applied/converged fingerprint, but prevents the
              // exact same state from being mislabelled as a new external edit.
              try {
                const partialTracks = await getPlaylistTracks(plexPlaylist.ratingKey, 99999)
                recordSourceObservation(source.id, {
                  plexFingerprint: buildPlexPlaylistFingerprint(partialTracks),
                })
              } catch {
                // Preserve and report the original mutation failure.
              }
              throw err
            } finally {
              releaseIdentityLock?.()
            }
            throwIfCancelled()

            job.finishStep(s4, 'success', 'Plex 歌单重排完成')
            recordActivityEvent({
              domain: 'plex',
              type: 'plex_playlist_reordered',
              severity: 'success',
              title: `Plex 歌单已重排`,
              summary: `“${playlistName}”已按最新顺序同步到 Plex。`,
              context: { sourceId: source.id, sourceName: playlistName, jobId: job.getId(), ratingKey: plexPlaylist.ratingKey },
              link: `/task-center/runs/${job.getId()}`,
              groupKey: `job:${job.getId()}:source:${source.id}`,
            })
          }

          // ── Finalize source ──
          const succCount = job.getRun().songs.filter((s) => s.status === 'success' && s.sourceId === source.id).length
          const existingCount = job.getRun().songs.filter((s) => s.status === 'skipped_existing' && s.sourceId === source.id).length
          const resolvedTargetCount = succCount + existingCount
          const failCount = job.getRun().songs.filter((s) =>
            ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status) && s.sourceId === source.id,
          ).length
          const restrictedCount = job.getRun().songs.filter((s) => s.status === 'copyright_restricted' && s.sourceId === source.id).length
          const ignoredCount = job.getRun().songs.filter((s) => s.status === 'ignored_failure' && s.sourceId === source.id).length
          const pendingReviewCount = job.getRun().songs.filter((s) => s.status === 'match_pending_review' && s.sourceId === source.id).length
          const preservedExtraCount = job.getRun().songs.filter((s) => s.status === 'extra_skipped' && s.sourceId === source.id).length

          let sourceStatus: PlaylistSource['lastStatus'] = 'success'
          if (failCount > 0 && resolvedTargetCount === 0) sourceStatus = 'failed'
          else if (
            failCount > 0
            || pendingReviewCount > 0
            || restrictedCount > 0
            || ignoredCount > 0
            || (!skipRemoveExtra && preservedExtraCount > 0)
          ) sourceStatus = 'partial'

          if (!dryRun) {
            for (const song of job.getRun().songs) {
              if (song.sourceId !== source.id || typeof song.neteaseIndex !== 'number') continue
              recordPlaylistOccurrenceSyncResult({
                sourceId: source.id,
                position: song.neteaseIndex,
                runId: job.getId(),
                status: song.status,
                matchTrace: song.metadata?.matchTrace as Record<string, unknown> | undefined,
                error: song.error as Record<string, unknown> | undefined,
              })
            }
          }

          // Re-fetch plexUpdatedAt after reorder (playlist was modified)
          let finalPlexUpdatedAt = plexUpdatedAt
          if (plexPlaylist?.ratingKey) {
            finalPlexUpdatedAt = await getPlaylistUpdatedAt(plexPlaylist.ratingKey)
          }

          if (!dryRun) {
            const sourceUpdate: Parameters<typeof updateSource>[1] = {
              lastSyncedAt: new Date().toISOString(),
              lastStatus: sourceStatus,
              lastError: sourceStatus === 'success'
                ? null
                : [
                    failCount > 0 ? `${failCount} 首失败` : '',
                    restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '',
                    ignoredCount > 0 ? `${ignoredCount} 首已暂停重试` : '',
                    pendingReviewCount > 0 ? `${pendingReviewCount} 首候选待审核` : '',
                    !skipRemoveExtra && preservedExtraCount > 0 ? `${preservedExtraCount} 首保留待确认` : '',
                  ].filter(Boolean).join('，'),
              lastJobId: job.getId(),
              trackCount: authoritativeTrackCount,
              plexPlaylistRatingKey: plexPlaylist?.ratingKey || '',
              plexUpdatedAt: finalPlexUpdatedAt,
              consecutiveSkips: 0,
              // lastFullCompareAt records work performed; the durable observed
              // and compared cursors above handle partial runs separately.
              lastFullCompareAt: new Date().toISOString(),
            }
            if (sourceStatus === 'success') {
              // Legacy fields remain convergence markers for incremental diff.
              sourceUpdate.lastTrackUpdateTime = trackUpdateTime
              sourceUpdate.trackIdSnapshot = JSON.stringify(currentIdOrder)
              sourceUpdate.requiresMatchReconcile = false
            }
            updateSource(source.id, sourceUpdate)
          }

          // Update copyright-restricted and failure caches
          const newRestricted = job.getRun().songs
            .filter((s) => s.status === 'copyright_restricted' && s.sourceId === source.id)
            .map((s) => s.neteaseSongId)
            .filter(Boolean) as number[]
          if (!dryRun && newRestricted.length > 0) {
            const merged = [...new Set([...knownRestricted, ...newRestricted])]
            updateSource(source.id, { copyrightRestrictedIds: JSON.stringify(merged) })
          }

          // Track failure counts: increment for failed (download/Plex) songs
          const matchedSongIds = job.getRun().songs
            .filter((s) =>
              s.sourceId === source.id
              && typeof s.neteaseSongId === 'number'
              && ['success', 'skipped_existing'].includes(s.status),
            )
            .map((s) => s.neteaseSongId as number)

          let nextFailureMemory = removeFailures(failureMemory, matchedSongIds)

          const failedSongs = job.getRun().songs
            .filter((s) =>
              ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status) && s.sourceId === source.id,
            )
            .filter((s): s is typeof s & {
              neteaseSongId: number
              status: 'failed_download' | 'failed_tags' | 'failed_plex_match' | 'failed_plex_insert'
              phase: 'download' | 'tags' | 'plex_match' | 'plex_insert'
            } => typeof s.neteaseSongId === 'number' && s.phase !== 'done')

          for (const failedSong of failedSongs) {
            const cause = failedSong.error?.context?.cause
            if (failedSong.status === 'failed_plex_match' && cause === 'library_visibility') continue

            nextFailureMemory = recordFailure(nextFailureMemory, failedSong.neteaseSongId, {
              status: failedSong.status,
              phase: failedSong.phase,
              message: failedSong.error?.message,
              suspectedCause: cause === 'library_visibility' || cause === 'metadata_mismatch' ? cause : 'unknown',
            })
          }

          if (!dryRun) updateSource(source.id, { ignoredFailureIds: serializeFailureMemory(nextFailureMemory) })

          totalFailed += failCount
          if (sourceStatus === 'success') successfulSources++
          else if (sourceStatus === 'partial') partialSources++
          else failedSources++

          const parts = [`${succCount} 新增成功`, `${existingCount} 已存在`]
          if (failCount > 0) parts.push(`${failCount} 失败`)
          if (restrictedCount > 0) parts.push(`${restrictedCount} 版权受限`)
          if (ignoredCount > 0) parts.push(`${ignoredCount} 已暂停重试`)
          if (pendingReviewCount > 0) parts.push(`${pendingReviewCount} 候选待审核`)
          if (!skipRemoveExtra && preservedExtraCount > 0) parts.push(`${preservedExtraCount} 保留待确认`)
          log('info', `歌单「${playlistName}」: ${parts.join(', ')}`)
          recordActivityEvent({
            domain: 'sync',
            type: sourceStatus === 'success' ? 'source_sync_completed' : sourceStatus === 'partial' ? 'source_sync_partial' : 'source_sync_failed',
            severity: sourceStatus === 'success' ? 'success' : sourceStatus === 'partial' ? 'warning' : 'error',
            title: `同步源“${playlistName}”${sourceStatus === 'success' ? '完成' : sourceStatus === 'partial' ? '部分完成' : '失败'}`,
            summary: parts.join('，'),
            context: {
              sourceId: source.id,
              sourceName: playlistName,
              jobId: job.getId(),
              successSongs: succCount,
              existingSongs: existingCount,
              failedSongs: failCount,
              restrictedSongs: restrictedCount,
              pausedRetrySongs: ignoredCount,
              pendingReviewSongs: pendingReviewCount,
              preservedExtraSongs: skipRemoveExtra ? 0 : preservedExtraCount,
            },
            link: `/task-center/runs/${job.getId()}`,
            groupKey: `job:${job.getId()}:source:${source.id}`,
          })
    } catch (err) {
      if (err instanceof CancellationError) throw err

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `歌单「${source.name}」同步失败: ${message}`)
      if (!dryRun) {
        updateSource(source.id, {
          lastSyncedAt: new Date().toISOString(),
          lastStatus: 'failed',
          lastError: message,
        })
      }
      recordActivityEvent({
        domain: 'sync',
        type: 'source_sync_failed',
        severity: 'error',
        title: `同步源“${source.neteasePlaylistName || source.name}”失败`,
        summary: message,
        context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, jobId: job.getId() },
        link: `/task-center/runs/${job.getId()}`,
        groupKey: `job:${job.getId()}:source:${source.id}`,
      })
      totalFailed++
      failedSources++
    }
  }

  // ── Overall finalize ──
  const jobStatus: 'success' | 'partial' | 'failed' = failedSources > 0 && successfulSources === 0 && partialSources === 0
    ? 'failed'
    : partialSources > 0 || failedSources > 0 || totalFailed > 0
      ? 'partial'
      : 'success'

  const finishedJob = job.finish(jobStatus, '')
  const summary = buildSyncRunSummary({ job: finishedJob, sourceCount: sources.length, dryRun, rebuildMatch, redownloadAll })
  finishedJob.summary = summary
  saveSyncRun(finishedJob)
  recordSyncRunCompletion(finishedJob, summary)

  log('info', summary)
  finishState(finishedJob.status === 'success' ? 'success' : 'failure')
  return { ...state }
    } catch (err) {
      if (err instanceof CancellationError) {
        const j = job.finish('cancelled', '用户取消')
        saveSyncRun(j)
        finishState('success')
        return { ...state }
      }

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `同步失败: ${message}`)

      const j = job.finish('failed', message)
      saveSyncRun(j)
      recordActivityEvent({
        domain: 'sync',
        type: 'sync_run_failed',
        severity: 'error',
        title: '同步任务异常失败',
        summary: message,
        context: { jobId: j.id },
        link: `/task-center/runs/${j.id}`,
        groupKey: `job:${j.id}`,
      })
      finishState('failure')
      return { ...state }
    } finally {
      state.isRunning = false
      currentRun = null
    }
  }

  async function runSyncForSource(sourceId: string, options?: SyncRunOptions): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    return runSync({ ...options, sourceIds: [sourceId] })
  }

  function startSync(options?: SyncRunOptions): { runId: string } {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    const job = new RunBuilder(options?.dryRun ?? false)
    const runId = job.getId()
    runSync(options, job).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log('error', `同步后台任务异常退出: ${message}`)
    })
    return { runId }
  }

  function startSyncForSource(sourceId: string, options?: SyncRunOptions): { runId: string } {
    return startSync({
      dryRun: options?.dryRun,
      sourceIds: [sourceId],
      forceFull: options?.forceFull,
      rebuildMatch: options?.rebuildMatch,
      redownloadAll: options?.redownloadAll,
      takeOverExternal: options?.takeOverExternal,
      trigger: options?.trigger,
    })
  }

  function cancelSync(): boolean {
    if (!state.isRunning) return false
    cancelRequested = true
    return true
  }

  function setStage(stage: SyncState['currentStage']) {
    state.currentStage = stage
    state.currentSourceName = currentSourceName || null
    emitEvent({
      type: 'stage-change',
      data: { stage, label: STAGE_LABELS[stage] || stage, sourceName: currentSourceName },
      timestamp: new Date().toISOString(),
    })
    if (currentRun) saveSyncRun(currentRun.getRun())
  }
  function addFailure(songName: string, reason: string) {
    state.failures.push({ songName, reason, timestamp: new Date().toISOString() })
  }
  function finishState(result: 'success' | 'failure') {
    state.lastSyncAt = new Date().toISOString()
    state.lastSyncResult = result
    state.syncCount++
    if (result === 'success') state.successCount++
    else state.failureCount++
    state.isRunning = false
    state.currentStage = 'idle'
    state.currentSourceName = null
    state.progress = null
    state.currentSong = null
    emitEvent({
      type: 'stage-change',
      data: { stage: 'idle', label: '空闲', sourceName: currentSourceName },
      timestamp: new Date().toISOString(),
    })
  }

  return { getState, runSync, runSyncForSource, startSync, startSyncForSource, cancelSync }
}
