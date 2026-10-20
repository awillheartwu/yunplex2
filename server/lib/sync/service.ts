import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, clearAlbumCache, setArtistAliases } from '../netease'
import { getPlaylistSnapshotByRatingKey, initPlexClient } from '../plex-client'
import { RunBuilder } from '../run/builder'
import { cancelRunDownloads } from '../download/queue-control'
import { saveSyncRun } from '../run/store'
import type { SongStatus, StepError } from '../job/types'
import { projectStaticResolutionStatus } from '../../../lib/media-status-projection'
import {
  getEnabledSources, getSource, listSources,
  recordSourceComparison, recordSourceObservation, updateSource,
} from '../playlist/store'
import { emitEvent } from './events'
import { reconcileSource } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'
import { markAutomaticSongIdentityBindingsStale } from './identity-store'
import { resolveEffectiveSourceSyncSettings } from './effective-settings'
import { resolveSyncModePolicy } from './mode-policy'
import { observePlaylistSourceTracks } from './match-management-store'
import { captureBindingVersions } from './identity-coordinator'
import {
  getSourceFailurePolicy,
  getSourceFailureStatus,
  isTerminalFailure,
  ignoreExhaustedFailures,
} from '../tasks/failure-records'
import { CancellationError, createInitialState, STAGE_LABELS, type SyncRunOptions } from './service-state'
import { buildSyncRunSummary } from './service-summary'
import {
  buildNeteasePlaylistCursor,
  buildPlexPlaylistFingerprint,
  buildPlexPathSnapshot,
  classifyPlexPlaylistObservation,
  serializeOrderedSnapshot,
} from './playlist-fingerprint'
import { planMissingMedia } from './missing-media-policy'
import { finalizeSourceConvergence, recordSourceConvergenceFailure } from './source-finalization'
import { applySourceDownloads } from './source-downloads'
import { reconcilePlexPlaylist } from './source-plex-reconciliation'
import { tryApplyPureSourceReorder } from './source-pure-reorder'
import { assertSourcesReadyForConvergence } from '../source-initialization/gate'
import { withExternalRequestSignal } from '../external-request-context'
import { getMediaCorrection } from './media-corrections'
import { plexRecoveryConfigFingerprint } from './plex-index-recovery'
import {
  addMissingDetailSongs,
  loadSourceSongSnapshot,
  resolveSourceSkipState,
} from './source-preparation'
import { detectPlexPathDrift, resolveTrustedSongSnapshot } from './source-snapshot'

export { STAGE_LABELS } from './service-state'

export function getSyncService(getConfig: () => AppConfig) {
  let state = createInitialState()
  let cancelRequested = false
  let currentSourceName = ''
  let currentSourceId: string | null = null
  let currentRun: RunBuilder | null = null
  let requestController: AbortController | null = null

  function getState(): SyncState { return { ...state, currentRunId: currentRun?.getId() ?? null } }

  function getCurrentRun() {
    if (!currentRun || state.dryRun) return null
    const run = currentRun.getRun()
    return {
      ...run,
      durationMs: Date.now() - new Date(run.startedAt).getTime(),
      songs: run.songs.filter(song => song.status !== 'pending' && song.status !== 'skipped_existing'),
    }
  }

  function throwIfCancelled(): void {
    if (!cancelRequested) return
    state.currentStage = 'cancelled'
    throw new CancellationError()
  }

  function log(level: 'warn' | 'error', message: string, detail?: string) {
    const entry = appendLog({ level, message, detail, stage: state.currentStage })
    emitEvent({
      type: 'log',
      data: { id: entry.id, level, message, detail, stage: entry.stage, timestamp: entry.timestamp },
      timestamp: entry.timestamp,
    })
  }

  async function runSync(options?: SyncRunOptions, preparedJob?: RunBuilder): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    const controller = new AbortController()
    requestController = controller
    try {
      return await withExternalRequestSignal(controller.signal, () => executeSync(options, preparedJob))
    } finally {
      if (requestController === controller) requestController = null
    }
  }

  async function executeSync(options?: SyncRunOptions, preparedJob?: RunBuilder): Promise<SyncState> {

    clearAlbumCache()

    const mode = options?.mode ?? 'normal'
    const modePolicy = resolveSyncModePolicy(mode)
    const dryRun = modePolicy.dryRun
    const targetIds = options?.sourceIds
    const rebuildMatch = modePolicy.rebuildAutomaticBindings
    const redownloadAll = modePolicy.redownloadManagedMedia
    const retrySourceFailures = options?.trigger === 'retry'
    const retrySongIds = new Set(retrySourceFailures ? options?.retrySongIds ?? [] : [])
    const takeOverExternal = options?.takeOverExternal ?? false
    const plexRecoveryOnly = options?.plexRecoveryOnly === true
    cancelRequested = false
    currentSourceId = targetIds?.length === 1 ? targetIds[0]! : null
    currentSourceName = ''
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = preparedJob ?? new RunBuilder(dryRun)
    currentRun = job
    if (!dryRun) saveSyncRun(job.getRun(), options?.trigger || 'system')

    try {
      const globalConfig = getConfig()
      const multiFormat = globalConfig.other?.multiArtistFormat ?? 'ampersand'
      setArtistAliases(globalConfig.other?.artistAliases ?? {}, globalConfig.other?.applyAliasToAlbum ?? false)
      const splitArtists = createSplitArtists(multiFormat)

      const allSources = getEnabledSources()
      const sources = targetIds
        ? listSources().filter((s) => targetIds.includes(s.id)) // manual trigger: include disabled (e.g. albums)
        : allSources
      if (sources.length === 0) throw new Error('没有可同步的歌单源，请在「歌单源」页面添加')
      assertSourcesReadyForConvergence(sources, globalConfig)

      // ── Validate ──
      if (!globalConfig.netease.cookie) throw new Error('未配置网易云 Cookie')
      if (!globalConfig.plex.server || !globalConfig.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')
      job.setSourceIds(sources.map(source => source.id))
      if (!dryRun) saveSyncRun(job.getRun())

      // ── Sync each source ──
      let totalFailed = 0
      let successfulSources = 0
      let partialSources = 0
      let failedSources = 0
      let recoveryDeferredReason: string | null = null

      for (const source of sources) {
        throwIfCancelled()
        const cfg = {
          ...globalConfig,
          netease: { ...globalConfig.netease, quality: source.quality ?? globalConfig.netease.quality },
        }
        currentSourceId = source.id
        currentSourceName = source.name || `网易云歌单 #${source.neteasePlaylistId}`
        state.stageHistory = []
        const rawLimit = source.syncLimit ?? cfg.sync.songLimit
        const sourceSongLimit = rawLimit === 0 ? undefined : rawLimit
        const playlistId = source.neteasePlaylistId
        const playlistName = currentSourceName
        const isAlbum = source.type === 'album'
        const effectiveSettings = resolveEffectiveSourceSyncSettings(source, cfg)
        const skipPlexPL = isAlbum && effectiveSettings.skipPlexPlaylist
        const skipRemoveExtra = plexRecoveryOnly || effectiveSettings.skipRemoveExtraTracks
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
          if (!dryRun) ignoreExhaustedFailures(source.id, cfg.sync.maxFailureAttempts)
          const sourceFailureStatus = getSourceFailureStatus(source.id)
          if (!dryRun && sourceFailureStatus === 'ignored') {
            const ignoredStep = job.startStep('source_ignored', '来源同步错误已忽略', { context: stepContext })
            job.finishStep(ignoredStep, 'skipped', '本轮未重新执行，请在异常处理中重试该来源错误。')
            updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastJobId: job.getId() })
            partialSources++
            continue
          }
          // ── Step 1: Fetch playlist ──
          const s1 = job.startStep('fetch_playlist', `获取${isAlbum ? '专辑' : '歌单'}: ${playlistName}`, {
            context: stepContext,
          })
          setStage('fetching_playlist')

          const cookieCheck = await checkCookie(cfg.netease.cookie)
          if (!cookieCheck.valid) {
            const title = cookieCheck.networkError ? '网易云连接失败' : 'Cookie 验证失败'
            const err: StepError = { title, message: cookieCheck.networkError ? '网易云服务暂时不可用，请检查网络后重试' : '网易云 Cookie 已失效，请重新获取并更新配置', stage: 'fetch_playlist', code: cookieCheck.networkError ? 'netease_unavailable' : 'authentication_failed' }
            job.failStep(s1, title, err)
            throw new Error(err.message)
          }

          const {
            songs: yunSongs,
            trackUpdateTime,
            trackIds,
            allTrackIds,
            playlistName: nePlaylistName,
            detailSummary,
          } = await loadSourceSongSnapshot({
            source,
            playlistId,
            limit: sourceSongLimit,
            cookie: cfg.netease.cookie,
            dryRun,
          })
          throwIfCancelled()

          // Detect Netease playlist rename
          if (nePlaylistName && nePlaylistName !== source.neteasePlaylistName) {
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
          const recoverySnapshot = options?.plexRecoverySnapshot
          const recoveryBindings = plexRecoveryOnly && recoverySnapshot ? captureBindingVersions(currentIdOrder) : null
          if (plexRecoveryOnly && (!cfg.sync.enabled || !source.enabled || !recoverySnapshot
            || recoverySnapshot.configFingerprint !== plexRecoveryConfigFingerprint(cfg)
            || recoverySnapshot.playlistRatingKey !== source.plexPlaylistRatingKey
            || neteaseCursor !== recoverySnapshot.neteaseCursor
            || recoverySnapshot.bindingVersions.some(([id, version]) => recoveryBindings?.get(id) !== version)
            || recoveryBindings?.size !== recoverySnapshot.bindingVersions.length
            || neteaseCursor !== source.lastComparedNeteaseCursor || missingSongDetailIds.length
            || !source.plexPlaylistRatingKey || yunSongs.some(song => getMediaCorrection(song.id)))) {
            recoveryDeferredReason = '索引恢复已延后：来源、目标曲目或媒体处理状态已变化，等待正常同步'
            job.finishStep(s1, 'skipped', recoveryDeferredReason)
            successfulSources++
            continue
          }
          let plexUpdatedAt: number | null = null
          let observedPlexFingerprint: string | null = null
          let observedPlexPaths: string | null = null
          let plexObservationKind: ReturnType<typeof classifyPlexPlaylistObservation> = 'initial'
          if (source.plexPlaylistRatingKey) {
            await initPlexClient(cfg.plex)
            const staleRatingKey = source.plexPlaylistRatingKey
            const snapshot = await getPlaylistSnapshotByRatingKey(staleRatingKey, 99999)
            if (snapshot) {
              plexUpdatedAt = snapshot.updatedAt
              observedPlexFingerprint = buildPlexPlaylistFingerprint(snapshot.tracks)
              observedPlexPaths = buildPlexPathSnapshot(snapshot.tracks)
              plexObservationKind = classifyPlexPlaylistObservation(observedPlexFingerprint, {
                lastObservedPlexFingerprint: source.lastObservedPlexFingerprint,
                lastAppliedPlexFingerprint: source.lastAppliedPlexFingerprint,
              })
              if (plexRecoveryOnly && (observedPlexFingerprint !== recoverySnapshot?.plexFingerprint
                || observedPlexFingerprint !== (source.lastAppliedPlexFingerprint ?? source.lastObservedPlexFingerprint))) {
                recoveryDeferredReason = 'Plex 歌单已发生外部变化，索引恢复已延后，等待正常同步'
                job.finishStep(s1, 'skipped', recoveryDeferredReason)
                successfulSources++
                continue
              }
            } else {
              if (plexRecoveryOnly) {
                recoveryDeferredReason = 'Plex 歌单已不存在，索引恢复已延后，等待正常同步'
                job.finishStep(s1, 'skipped', recoveryDeferredReason)
                successfulSources++
                continue
              }
              log('warn', `Plex 目标歌单已被删除（旧 ID: ${staleRatingKey}），本轮将按同步源配置重新查找或创建`)
              // Clear every field derived from the deleted Plex playlist. The
              // in-memory mutation forces this run through full reconciliation;
              // persistence ensures a failed recreation never retries the stale
              // ratingKey on the next run.
              source.plexPlaylistRatingKey = ''
              source.plexUpdatedAt = null
              source.lastObservedPlexFingerprint = null
              source.lastAppliedPlexFingerprint = null
              source.observedPlexPaths = null
              source.appliedPlexPaths = null
              source.requiresMatchReconcile = true
              stepContext.plexPlaylistRatingKey = undefined
              if (!dryRun) {
                updateSource(source.id, {
                  plexPlaylistRatingKey: '',
                  plexUpdatedAt: null,
                  lastObservedPlexFingerprint: null,
                  lastAppliedPlexFingerprint: null,
                  observedPlexPaths: null,
                  appliedPlexPaths: null,
                  requiresMatchReconcile: true,
                })
              }
            }
          }

          if (!dryRun) {
            recordSourceObservation(source.id, {
              neteaseCursor,
              plexFingerprint: observedPlexFingerprint,
              neteaseIds: serializeOrderedSnapshot(currentIdOrder),
              plexPaths: observedPlexPaths,
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
          const {
            changedRatingKeys: changedPlexRatingKeys,
            detected: plexPathDriftDetected,
          } = detectPlexPathDrift({
            appliedPaths: source.appliedPlexPaths,
            observedPaths: observedPlexPaths,
            enabled: cfg.sync.reconcileOnPlexDrift !== false,
            isAlbum,
            dryRun,
            hasPlexPlaylist: Boolean(source.plexPlaylistRatingKey),
          })
          const plexDriftDetected = !isAlbum
            && !dryRun
            && cfg.sync.reconcileOnPlexDrift !== false
            && Boolean(source.plexPlaylistRatingKey)
            && (
              plexPathDriftDetected
              || (
                (plexObservationKind === 'external_change' || legacyTimestampDrift)
                && (currentSnapshotAlreadyCompared || legacyTimestampDrift)
              )
            )
          const missingMediaPolicyEnabled = !plexRecoveryOnly && mode !== 'redownload_managed'
          const failurePolicy = getSourceFailurePolicy(source.id)
          const ignoredSongIds = new Set(Object.entries(failurePolicy.failuresBySongId)
            .filter(([id, failure]) => isTerminalFailure(failure, cfg.sync.maxFailureAttempts) && !retrySongIds.has(Number(id)))
            .map(([id]) => Number(id)))
          const missingMediaWorkDetected = missingMediaPolicyEnabled
            && [...planMissingMedia(yunSongs, cfg, { validateAudio: false }).values()].some(plan =>
              !['manual_exempt', 'reuse_managed', 'wait_manual'].includes(plan.disposition)
              && !isTerminalFailure(failurePolicy.failuresBySongId[plan.songId], cfg.sync.maxFailureAttempts),
            )
          const det = detectChanges({
            isAlbum,
            trackUpdateTime,
            lastTrackUpdateTime: currentSnapshotAlreadyCompared ? trackUpdateTime : source.lastTrackUpdateTime,
            manualForce: plexRecoveryOnly || modePolicy.forceFullCompare
              || effectiveSettings.forceFullCompare
              || source.requiresMatchReconcile
              || missingMediaWorkDetected,
            dryRun,
            consecutiveSkips: source.consecutiveSkips || 0,
            fullCompareAfterSkips: effectiveSettings.fullCompareAfterSkips,
            fullCompareAfterDays: effectiveSettings.fullCompareAfterDays,
            lastFullCompareAt: source.lastFullCompareAt,
            currentIdOrder,
            trackIdSnapshot: source.observedNeteaseIds ?? source.trackIdSnapshot,
            plexDriftDetected,
          })
          const retryUnresolvedSnapshot = det.skipEntirely
            && (source.lastStatus === 'partial' || source.lastStatus === 'failed')

          job.finishStep(
            s1,
            missingSongDetailIds.length > 0 ? 'partial' : 'success',
            `歌单获取完成，共 ${authoritativeTrackCount} 个目标${missingSongDetailIds.length > 0 ? `，${missingSongDetailIds.length} 首缺少详情` : ''}${detailSummary ?? ''}（${det.changedMsg}${det.diffMsg ? '，' + det.diffMsg : ''}）`,
          )

          if (rebuildMatch && !dryRun) {
            markAutomaticSongIdentityBindingsStale(currentIdOrder.filter(id => !ignoredSongIds.has(id)), {
              sourceId: source.id,
              runId: job.getId(),
            })
          }

          // Skip entirely if Netease unchanged
          const { unresolvedMissingDetailIds, hasActionableFailures, unresolvedPartialState }
            = resolveSourceSkipState({
              source,
              missingSongDetailIds,
              failurePolicy,
              maxFailureAttempts: cfg.sync.maxFailureAttempts,
            })
          if (
            det.skipEntirely
            && sourceFailureStatus !== 'open'
            && !hasActionableFailures
            && !unresolvedPartialState
            && unresolvedMissingDetailIds.length === 0
            && !(authoritativeTrackCount === 0 && source.lastStatus !== 'success')
          ) {
            const unchangedStatus = source.lastStatus === 'idle' ? 'success' : source.lastStatus
            job.recordUnchangedSource(stepContext, authoritativeTrackCount,
              new Set(currentIdOrder.filter(id => failurePolicy.failuresBySongId[id])).size, source.lastError)
            updateSource(source.id, {
              lastSyncedAt: new Date().toISOString(), lastStatus: unchangedStatus, lastError: source.lastError,
              lastJobId: job.getId(), trackCount: authoritativeTrackCount,
              lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt,
              observedNeteaseIds: serializeOrderedSnapshot(currentIdOrder),
              consecutiveSkips: (source.consecutiveSkips || 0) + 1,
            })
            if (unchangedStatus === 'success') successfulSources++
            else if (unchangedStatus === 'partial') partialSources++
            else failedSources++
            continue
          }

          // Pure reorder: skip download, just reorder Plex playlist
          if (!plexRecoveryOnly && sourceFailureStatus !== 'open' && Object.keys(failurePolicy.failuresBySongId).length === 0
            && det.isPureReorder && !det.needFullCompare && missingSongDetailIds.length === 0) {
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
              setStage,
              log: (level, message) => log(level, message),
            })
            if (reordered) {
              if (!dryRun) {
                recordSourceComparison(source.id, {
                  neteaseCursor,
                })
              }
              if (!dryRun) updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null, lastJobId: job.getId(), trackCount: authoritativeTrackCount, lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt, consecutiveSkips: 0, trackIdSnapshot: JSON.stringify(currentIdOrder), requiresMatchReconcile: false })
              successfulSources++
              continue
            }
          }

          // ── Step 2: Reconcile (tiered lookup: DB → Plex → disk → download) ──
          setStage('comparing')
          const forceFullVerification = isAlbum || plexRecoveryOnly || modePolicy.forceFullCompare
            || effectiveSettings.forceFullCompare || source.requiresMatchReconcile
            || rebuildMatch || missingMediaWorkDetected || det.autoForce || dryRun
          const trustedSongIds = resolveTrustedSongSnapshot({
            source,
            currentIdOrder,
            observedPlexPaths,
            changedRatingKeys: changedPlexRatingKeys,
            forceFullVerification,
          })
          const { resolutions, plexPlaylist: plexPlaylistResult, sectionKey, extraTracks } = await reconcileSource(
            source, yunSongs, cfg, job, splitArtists,
            () => cancelRequested,
            skipPlexPL,
            dryRun,
            {
              automaticMediaFallback: missingMediaPolicyEnabled,
              requireExistingPlaylist: plexRecoveryOnly,
              trustedSongIds,
              ignoredSongIds,
            },
          )
          throwIfCancelled()
          const bindingVersionSnapshot = captureBindingVersions(currentIdOrder)
          const plexPlaylist = plexPlaylistResult
          if (plexRecoveryOnly && (resolutions.some(item => ['needs_download', 'unavailable'].includes(item.resolution))
            || !resolutions.some(item => item.resolution === 'found_in_plex_library'))) {
            recoveryDeferredReason = '暂无可安全补齐的媒体，等待正常同步；本次不下载或扫描'
            job.finishStep(job.startStep('compare', '核对迟到入库的托管文件'), 'skipped', recoveryDeferredReason)
            successfulSources++
            continue
          }
          // Register outcomes only after the comparison is safe to apply.
          const allSongs = yunSongs.map((s, neteaseIndex) => ({
            songName: s.name,
            artist: joinArtist(s.artists),
            album: s.album.name,
            status: 'pending' as SongStatus,
            neteaseSongId: s.id,
            neteaseIndex,
          }))
          job.addSongs(source.id, allSongs)
          addMissingDetailSongs(job, source.id, missingSongDetailIds, failurePolicy)

          if (!dryRun) {
            recordSourceComparison(source.id, {
              neteaseCursor,
              plexFingerprint: observedPlexFingerprint,
            })
          }

          // Update job song statuses from TrackResolution results
          for (const r of resolutions) {
            const songId = job.findSongIdByIndex(source.id, r.neteaseIndex)
              ?? job.findSongId(source.id, r.song.id)
            if (!songId) continue
            if (r.matchTrace) {
              job.updateSong(songId, { metadata: { matchTrace: { ...r.matchTrace } } })
            }
            if (r.resolution === 'unavailable') {
              job.updateSong(songId, { status: 'failed_download', phase: 'download', error: { title: '歌曲不可用', message: '网易云无下载链接', stage: 'download', songName: r.song.name, artist: splitArtists(r.song.artists)[0] } })
            } else if (r.resolution === 'ignored_failure') {
              const entry = failurePolicy.failuresBySongId[r.song.id]
              job.updateSong(songId, { status: 'ignored_failure', phase: entry?.phase || 'download' })
            } else {
              const projection = projectStaticResolutionStatus(r.resolution)
              if (projection) job.updateSong(songId, projection)
            }
            // needs_download / found_on_disk stay pending
          }

          // Preview uses the initial comparison. Real runs classify extras
          // after the final Plex lookup, which can recognize more target songs.
          const extraTaskIds = new Map<number, string>()
          if (dryRun && !skipRemoveExtra) {
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
                    ...(xt.relatedNeteaseSongId !== undefined
                      ? { relatedNeteaseSongId: xt.relatedNeteaseSongId }
                      : {}),
                    deletionProtectionReason: xt.protectionReason,
                  },
                },
              })
            }
          }

          const { needsPlexRefresh } = plexRecoveryOnly ? { needsPlexRefresh: false } : await applySourceDownloads({
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
              plexPlaylist,
              sectionKey,
              currentIdOrder,
              bindingVersionSnapshot,
              emptyTargetConfirmed,
              skipRemoveExtra,
              retryUnresolvedSnapshot: plexRecoveryOnly || retryUnresolvedSnapshot,
              needsPlexRefresh,
              ...(plexRecoveryOnly ? {
                expectedPlexFingerprint: observedPlexFingerprint!,
                assertRecoveryContextUnchanged: () => {
                  const latestConfig = getConfig()
                  const latestSource = getSource(source.id)
                  if (!latestConfig.sync.enabled || !latestSource?.enabled
                    || latestSource.type !== source.type || latestSource.neteasePlaylistId !== source.neteasePlaylistId
                    || latestSource.syncLimit !== source.syncLimit || latestSource.plexPlaylistRatingKey !== source.plexPlaylistRatingKey
                    || recoverySnapshot?.configFingerprint !== plexRecoveryConfigFingerprint(latestConfig)) {
                    throw new Error('来源或连接设置在索引恢复期间被修改，本轮未执行 Plex 歌单写入')
                  }
                  assertSourcesReadyForConvergence([latestSource], latestConfig)
                },
              } : {}),
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
            fullVerification: trustedSongIds.size === 0,
            skipRemoveExtra,
            authoritativeTrackCount,
            currentIdOrder,
            trackUpdateTime,
            plexUpdatedAt,
            plexPlaylist,
          })
          totalFailed += sourceResult.failedSongs
          if (sourceResult.status === 'success') successfulSources++
          else if (sourceResult.status === 'partial') partialSources++
          else failedSources++
    } catch (err) {
      if (err instanceof CancellationError) throw err

      const message = recordSourceConvergenceFailure({ source, job, context: stepContext, error: err, stage: state.currentStage, dryRun })
      log('error', `歌单「${source.name}」同步失败: ${message}`)
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
  const baseSummary = buildSyncRunSummary({ job: finishedJob, sourceCount: sources.length, mode })
  const summary = plexRecoveryOnly ? (recoveryDeferredReason ?? `恢复 Plex 索引：${baseSummary}`) : baseSummary
  finishedJob.summary = summary
  if (!dryRun) {
    saveSyncRun(finishedJob)
    for (const source of sources) {
      ignoreExhaustedFailures(source.id, globalConfig.sync.maxFailureAttempts)
    }
  }

  finishState(finishedJob.status === 'failed'
    ? 'failure'
    : finishedJob.status === 'partial'
      ? 'partial'
      : 'success')
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

  function prepareSyncForSource(sourceId: string, options?: SyncRunOptions): {
    runId: string
    run: () => Promise<SyncState>
  } {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    const job = new RunBuilder(options?.mode === 'preview')
    job.setSourceIds([sourceId])
    if (options?.mode !== 'preview') saveSyncRun(job.getRun(), options?.trigger ?? 'user')
    return {
      runId: job.getId(),
      run: () => runSync({ ...options, sourceIds: [sourceId] }, job),
    }
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
    if (currentRun) cancelRunDownloads(currentRun.getId())
    requestController?.abort(new CancellationError())
    return true
  }

  function setStage(stage: SyncState['currentStage']) {
    state.currentStage = stage
    const history = state.stageHistory ??= []
    if (!history.includes(stage)) history.push(stage)
    state.currentSourceName = currentSourceName || null
    emitEvent({
      type: 'stage-change',
      data: { stage, stageHistory: [...history], label: STAGE_LABELS[stage] || stage, sourceName: currentSourceName, sourceId: currentSourceId },
      timestamp: new Date().toISOString(),
    })
    if (currentRun && !state.dryRun) saveSyncRun(currentRun.getRun())
  }
  function addFailure(songName: string, reason: string) {
    state.failures.push({ songName, reason, timestamp: new Date().toISOString() })
  }
  function finishState(result: 'success' | 'partial' | 'failure') {
    state.lastSyncAt = new Date().toISOString()
    state.lastSyncResult = result
    state.syncCount++
    if (result === 'success') state.successCount++
    else if (result === 'failure') state.failureCount++
    state.isRunning = false
    state.currentStage = 'idle'
    state.currentSourceName = null
    state.progress = null
    state.currentSong = null
    emitEvent({
      type: 'stage-change',
      data: { stage: 'idle', label: '空闲', sourceName: currentSourceName, sourceId: currentSourceId },
      timestamp: new Date().toISOString(),
    })
  }

  return { getState, getCurrentRun, runSync, runSyncForSource, prepareSyncForSource, startSync, startSyncForSource, cancelSync }
}
