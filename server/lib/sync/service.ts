import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, fetchPlaylistSongs, fetchAlbumSongs, clearAlbumCache, setArtistAliases } from '../netease'
import { configureResolver } from './artist-resolver'
import { getPlaylistSnapshotByRatingKey, initPlexClient } from '../plex-client'
import { RunBuilder } from '../run/builder'
import { cleanupOldRuns, saveSyncRun } from '../run/store'
import type { SongStatus } from '../job/types'
import {
  getEnabledSources, listSources,
  recordSourceComparison, recordSourceObservation, updateSource,
} from '../playlist/store'
import { cleanupOldDownloadTasks } from '../download/queue'
import { emitEvent } from './events'
import { reconcileSource } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'
import { markAutomaticSongIdentityBindingsStale } from './identity-store'
import { resolveEffectiveSourceSyncSettings } from './effective-settings'
import { resolveSyncModePolicy } from './mode-policy'
import { observePlaylistSourceTracks } from './match-management-store'
import { captureBindingVersions } from './identity-coordinator'
import { recordActivityEvent } from '../activity/store'
import { getFailureMemoryEntry, inferFailurePhase, parseFailureMemory, shouldSkipSongDueToFailure } from './failure-memory'
import { CancellationError, createInitialState, STAGE_LABELS, type SyncRunOptions } from './service-state'
import { buildSyncRunSummary, recordSyncRunCompletion } from './service-summary'
import {
  buildNeteasePlaylistCursor,
  buildPlexPlaylistFingerprint,
  classifyPlexPlaylistObservation,
} from './playlist-fingerprint'
import { hasMissingMediaPolicyWork } from './missing-media-policy'
import { finalizeSourceConvergence } from './source-finalization'
import { applySourceDownloads } from './source-downloads'
import { reconcilePlexPlaylist } from './source-plex-reconciliation'
import { tryApplyPureSourceReorder } from './source-pure-reorder'
import { parsePersistedIntegerIds, serializePersistedIntegerIds } from '~~/lib/persisted-integer-ids'

export { STAGE_LABELS } from './service-state'

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

    const mode = options?.mode ?? 'normal'
    const modePolicy = resolveSyncModePolicy(mode)
    const dryRun = modePolicy.dryRun
    const targetIds = options?.sourceIds
    const rebuildMatch = modePolicy.rebuildAutomaticBindings
    const redownloadAll = modePolicy.redownloadManagedMedia
    const takeOverExternal = options?.takeOverExternal ?? false
    cancelRequested = false
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = preparedJob ?? new RunBuilder(dryRun)
    currentRun = job
    if (!dryRun) saveSyncRun(job.getRun(), options?.trigger || 'system')

    try {
      const cfg = getConfig()
      const cleanedRuns = dryRun
        ? 0
        : cleanupOldRuns(cfg.sync.jobRetentionSuccessDays ?? 7, cfg.sync.jobRetentionFailedDays ?? 90)
      const cleanedTasks = dryRun
        ? 0
        : cleanupOldDownloadTasks(cfg.sync.downloadTaskRetentionDays ?? 30)
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
      if (!dryRun) saveSyncRun(job.getRun())

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
        const effectiveSettings = resolveEffectiveSourceSyncSettings(source, cfg)
        const skipPlexPL = isAlbum && effectiveSettings.skipPlexPlaylist
        const skipRemoveExtra = effectiveSettings.skipRemoveExtraTracks
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
          const missingMediaPolicyEnabled = effectiveSettings.downloadWhenMediaMissing
            && mode !== 'redownload_managed'
          const missingMediaWorkDetected = missingMediaPolicyEnabled
            && hasMissingMediaPolicyWork(yunSongs, cfg)
          const det = detectChanges({
            isAlbum,
            trackUpdateTime,
            lastTrackUpdateTime: currentSnapshotAlreadyCompared ? trackUpdateTime : source.lastTrackUpdateTime,
            manualForce: modePolicy.forceFullCompare
              || effectiveSettings.forceFullCompare
              || source.requiresMatchReconcile
              || missingMediaWorkDetected,
            dryRun,
            consecutiveSkips: source.consecutiveSkips || 0,
            fullCompareAfterSkips: effectiveSettings.fullCompareAfterSkips,
            fullCompareAfterDays: effectiveSettings.fullCompareAfterDays,
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
            const invalidated = markAutomaticSongIdentityBindingsStale(currentIdOrder, {
              sourceId: source.id,
              runId: job.getId(),
            })
            log('info', `歌单「${playlistName}」已保留人工绑定，并将 ${invalidated} 条自动绑定置为待重新评估`)
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
          if (missingMediaWorkDetected) {
            log('info', `歌单「${playlistName}」检测到未登记、缺失或已变化的媒体，进入完整处理`)
          }

          if (det.autoForce) log('info', `歌单「${playlistName}」触发自动全量对比（超过${cfg.sync.fullCompareAfterSkips > 0 ? '跳过次数' : '时间间隔'}）`)
          if (det.plexDriftDetected) log('info', `歌单「${playlistName}」检测到 Plex 侧更新，触发全量对齐`)

          // Pure reorder: skip download, just reorder Plex playlist
          if (det.isPureReorder && !det.needFullCompare && missingSongDetailIds.length === 0) {
            log('info', `歌单「${playlistName}」仅顺序变化，跳过下载直接重排`)
            const reordered = await tryApplyPureSourceReorder({
              source,
              songs: yunSongs,
              config: cfg,
              job,
              stepContext,
              dryRun,
              currentIdOrder,
              isCancellationRequested: () => cancelRequested,
              throwIfCancelled,
              log: (level, message) => log(level, message),
            })
            if (reordered) {
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
          const parsedRestricted = parsePersistedIntegerIds(source.copyrightRestrictedIds)
          const knownRestricted = parsedRestricted.ids
          if (parsedRestricted.issues.length > 0) {
            log(
              'warn',
              `歌单源「${source.name || source.neteasePlaylistName}」的版权受限缓存包含损坏数据，已保留有效歌曲 ID 并忽略无效内容`,
              `copyrightRestrictedIds: ${parsedRestricted.issues.join(', ')}`,
            )
            if (!dryRun) {
              updateSource(source.id, {
                copyrightRestrictedIds: serializePersistedIntegerIds(knownRestricted),
              })
            }
          }
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
            { downloadWhenMediaMissing: missingMediaPolicyEnabled },
          )
          throwIfCancelled()
          const bindingVersionSnapshot = captureBindingVersions(currentIdOrder)
          const plexPlaylist = plexPlaylistResult

          if (!dryRun) {
            recordSourceComparison(source.id, {
              neteaseCursor,
              plexFingerprint: observedPlexFingerprint,
            })
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
            const songId = job.findSongIdByIndex(source.id, r.neteaseIndex)
              ?? job.findSongId(source.id, r.song.id)
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

          const { needsPlexRefresh, downloadTargetCount } = await applySourceDownloads({
            source,
            resolutions,
            config: cfg,
            job,
            stepContext,
            dryRun,
            redownloadManagedMedia: redownloadAll,
            takeOverExternal,
            splitArtists,
            throwIfCancelled,
            setStage,
            addFailure,
            log,
          })

          if (!dryRun && !skipPlexPL) {
            await reconcilePlexPlaylist({
              source,
              resolutions,
              extraTracks,
              extraTaskIds,
              config: cfg,
              job,
              stepContext,
              playlistName,
              plexPlaylist,
              sectionKey,
              currentIdOrder,
              bindingVersionSnapshot,
              emptyTargetConfirmed,
              skipRemoveExtra,
              retryUnresolvedSnapshot,
              missingMediaPolicyEnabled,
              needsPlexRefresh,
              downloadTargetCount,
              splitArtists,
              isCancellationRequested: () => cancelRequested,
              throwIfCancelled,
              setStage,
              log,
            })
          }

          const sourceResult = await finalizeSourceConvergence({
            source,
            job,
            dryRun,
            skipRemoveExtra,
            authoritativeTrackCount,
            currentIdOrder,
            trackUpdateTime,
            plexUpdatedAt,
            plexPlaylist,
            knownRestricted,
            failureMemory,
            log,
          })
          totalFailed += sourceResult.failedSongs
          if (sourceResult.status === 'success') successfulSources++
          else if (sourceResult.status === 'partial') partialSources++
          else failedSources++
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
      if (!dryRun) recordActivityEvent({
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
  const summary = buildSyncRunSummary({ job: finishedJob, sourceCount: sources.length, mode })
  finishedJob.summary = summary
  if (!dryRun) {
    saveSyncRun(finishedJob)
    recordSyncRunCompletion(finishedJob, summary)
  }

  log('info', summary)
  finishState(finishedJob.status === 'success' ? 'success' : 'failure')
  return { ...state }
    } catch (err) {
      if (err instanceof CancellationError) {
        const j = job.finish('cancelled', '用户取消')
        if (!dryRun) saveSyncRun(j)
        finishState('success')
        return { ...state }
      }

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `同步失败: ${message}`)

      const j = job.finish('failed', message)
      if (!dryRun) saveSyncRun(j)
      if (!dryRun) recordActivityEvent({
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
    const job = new RunBuilder(options?.mode === 'preview')
    const runId = job.getId()
    runSync(options, job).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log('error', `同步后台任务异常退出: ${message}`)
    })
    return { runId }
  }

  function startSyncForSource(sourceId: string, options?: SyncRunOptions): { runId: string } {
    return startSync({
      mode: options?.mode,
      sourceIds: [sourceId],
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
    if (currentRun && !state.dryRun) saveSyncRun(currentRun.getRun())
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
