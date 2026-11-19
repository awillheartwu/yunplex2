import type { AppConfig } from '../config/types'
import type { SyncStage } from '../log/types'
import type { SongStatus, StepError } from '../job/types'
import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import { checkCookie, setArtistAliases } from '../netease'
import { getPlaylistSnapshotByRatingKey, initPlexClient, type PlexTrack } from '../plex-client'
import { confirmAuthenticationRestored } from '../download/environment-recovery'
import { projectStaticResolutionStatus } from '../../../lib/media-status-projection'
import { getSource, recordSourceComparison, recordSourceObservation, updateSource } from '../playlist/store'
import { reconcileSource } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'
import { getActiveSongIdentityBindings, markAutomaticSongIdentityBindingsStale } from './identity-store'
import { pruneUnavailableSongBindings } from './identity-availability'
import { resolveEffectiveSourceSyncSettings } from './effective-settings'
import { resolveSyncModePolicy } from './mode-policy'
import { observePlaylistSourceTracks } from './match-management-store'
import { captureBindingVersions } from './identity-coordinator'
import { getOpenMediaIdentityConflict, getSourceFailurePolicy, getSourceFailureStatus, shouldDeferFailure } from './failure-policy'
import { observeFailureSubject } from '../tasks/failure-records'
import { confirmSourceRead } from '../tasks/completion'
import { CancellationError, type SyncRunOptions } from './service-state'
import { buildNeteasePlaylistCursor, buildPlexPlaylistFingerprint, buildPlexPathSnapshot,
  classifyPlexPlaylistObservation, serializeOrderedSnapshot } from './playlist-fingerprint'
import { planMissingMedia } from './missing-media-policy'
import { finalizeSourceConvergence, recordSourceConvergenceFailure, type SourceConvergenceResult } from './source-finalization'
import { applySourceDownloads, type SourceDownloadResult } from './source-downloads'
import { reconcilePlexPlaylist } from './source-plex-reconciliation'
import { tryApplyPureSourceReorder } from './source-pure-reorder'
import { assertSourcesReadyForConvergence } from '../source-initialization/gate'
import { withExternalRequestSignal } from '../external-request-context'
import { getMediaCorrection } from './media-corrections'
import { sourceRecoveryGate } from './recovery'
import { captureSourceConvergenceCheckpoint } from './source-checkpoint'
import { plexRecoveryConfigFingerprint } from './plex-index-recovery'
import { addMissingDetailSongs, loadSourceSongSnapshot, resolveSourceSkipState } from './source-preparation'
import { detectPlexPathDrift, resolveTrustedSongSnapshot } from './source-snapshot'
import { pendingPlaylistWrite } from './playlist-write-state'
import { markMediaIdentityConflictAwaitingManual } from './download-diagnostics'

export type SourceExecutionOptions = Readonly<Omit<SyncRunOptions, 'sourceIds'>>

export interface SourceExecutionObserver {
  playlistProgress?: (value: import('../../../shared/playlist-write').PlaylistWriteProgress) => void
  stage: (stage: SyncStage) => void
  failure: (songName: string, reason: string) => void
  log: (level: 'warn' | 'error', message: string, detail?: string) => void
}

export interface SourceExecutionInput {
  source: Readonly<PlaylistSource>
  config: AppConfig
  options: SourceExecutionOptions
  job: RunBuilder
  signal: AbortSignal
  observer: SourceExecutionObserver
  readCurrentConfig: () => AppConfig
}

export type SourceExecutionResult = SourceConvergenceResult
  | { kind: 'unchanged'; status: 'success' | 'partial' | 'failed'; failedSongs: 0; summary: string }
  | { kind: 'deferred'; reason: 'source_gate'; status: 'partial'; failedSongs: 0; summary: string }
  | { kind: 'deferred'; reason: 'plex_recovery'; status: 'success'; failedSongs: 0; summary: string }

/** Execute one source attempt. Run lifecycle, aggregation and global state stay with the caller. */
export async function executeSourceConvergence(input: SourceExecutionInput): Promise<SourceExecutionResult> {
  return withExternalRequestSignal(input.signal, async () => {
    const { config, options, job, observer, readCurrentConfig } = input
    const source = { ...input.source }
    if (pendingPlaylistWrite(source.id)) source.requiresMatchReconcile = true
    const cfg = { ...config, netease: { ...config.netease, quality: source.quality ?? config.netease.quality } }
    const mode = options.mode ?? 'normal'
    const modePolicy = resolveSyncModePolicy(mode)
    const { dryRun, rebuildAutomaticBindings: rebuildMatch, redownloadManagedMedia: redownloadAll } = modePolicy
    const retrySourceFailures = options.trigger === 'retry'
    const retrySongIds = new Set(retrySourceFailures ? options.retrySongIds ?? [] : [])
    const takeOverExternal = options.takeOverExternal ?? false
    const plexRecoveryOnly = options.plexRecoveryOnly === true
    const splitArtists = createSplitArtists(config.other?.multiArtistFormat ?? 'ampersand')
    setArtistAliases(config.other?.artistAliases ?? {}, config.other?.applyAliasToAlbum ?? false)
    let stage: SyncStage = 'idle'
    const setStage = (next: SyncStage) => { stage = next; observer.stage(next) }
    const { failure: addFailure, log } = observer
    const throwIfCancelled = () => { if (input.signal.aborted) throw new CancellationError() }
    const rawLimit = source.syncLimit ?? cfg.sync.songLimit
    const sourceSongLimit = rawLimit === 0 ? undefined : rawLimit
    const playlistId = source.neteasePlaylistId
    const playlistName = source.name || `网易云歌单 #${playlistId}`
    const isAlbum = source.type === 'album'
    const effectiveSettings = resolveEffectiveSourceSyncSettings(source, cfg)
    const skipPlexPL = isAlbum && effectiveSettings.skipPlexPlaylist
    const skipRemoveExtra = plexRecoveryOnly || effectiveSettings.skipRemoveExtraTracks
    let sourceTrackCount: number | undefined
    const stepContext = { sourceId: source.id, sourceName: playlistName, sourceType: source.type,
      playlistName, plexPlaylistName: source.plexPlaylistName || source.neteasePlaylistName || playlistName,
      plexPlaylistRatingKey: source.plexPlaylistRatingKey || undefined, neteasePlaylistId: playlistId }
    job.setConfig({ playlistId, quality: cfg.netease.quality, server: cfg.plex.server, section: cfg.plex.section })
    try {
      throwIfCancelled()
      const recoveryGate = sourceRecoveryGate(source.id, cfg, options.trigger === 'user' || retrySourceFailures)
      const sourceFailureStatus = getSourceFailureStatus(source.id)
      if (!dryRun && recoveryGate) {
        observeFailureSubject({ sourceId: source.id, songName: '来源同步' }, job.getId())
        const ignoredStep = job.startStep('source_deferred', '来源等待恢复', { context: stepContext })
        const summary = recoveryGate.action === 'retry' ? `等待自动重试：${recoveryGate.nextRetryAt}` : '来源已暂停或忽略，请修复外部条件或手动重试。'
        job.finishStep(ignoredStep, 'skipped', summary)
        updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastJobId: job.getId() })
        return { kind: 'deferred', reason: 'source_gate', status: 'partial', failedSongs: 0, summary }
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

      if (!dryRun) await confirmAuthenticationRestored(cfg)
      const {
        songs: yunSongs,
        songIndices,
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
      if (!dryRun) confirmSourceRead(source.id)
      const missingSongDetailIds = currentIdOrder.filter(songId => !resolvedSongIds.has(songId))
      const authoritativeTrackCount = currentIdOrder.length
      sourceTrackCount = authoritativeTrackCount
      if (missingSongDetailIds.length > 0) {
        log('warn', `网易云歌单返回 ${authoritativeTrackCount} 个 trackId，但 ${missingSongDetailIds.length} 首缺少歌曲详情；这些目标已进入删除保护`)
      }
      const neteaseCursor = buildNeteasePlaylistCursor({
        trackIds: currentIdOrder,
        trackUpdateTime,
      })
      const recoverySnapshot = options.plexRecoverySnapshot
      const recoveryBindings = plexRecoveryOnly && recoverySnapshot ? captureBindingVersions(currentIdOrder) : null
      if (plexRecoveryOnly && (!cfg.sync.enabled || !source.enabled || !recoverySnapshot
        || recoverySnapshot.configFingerprint !== plexRecoveryConfigFingerprint(cfg)
        || recoverySnapshot.playlistRatingKey !== source.plexPlaylistRatingKey
        || neteaseCursor !== recoverySnapshot.neteaseCursor
        || recoverySnapshot.bindingVersions.some(([id, version]) => recoveryBindings?.get(id) !== version)
        || recoveryBindings?.size !== recoverySnapshot.bindingVersions.length
        || neteaseCursor !== source.lastComparedNeteaseCursor || missingSongDetailIds.length
        || !source.plexPlaylistRatingKey || yunSongs.some(song => getMediaCorrection(song.id)))) {
        const summary = '索引恢复已延后：来源、目标曲目或媒体处理状态已变化，等待正常同步'
        job.finishStep(s1, 'skipped', summary)
        return { kind: 'deferred', reason: 'plex_recovery', status: 'success', failedSongs: 0, summary }
      }
      let plexUpdatedAt: number | null = null
      let observedPlexFingerprint: string | null = null
      let observedPlexPaths: string | null = null
      let observedPlexTracks: PlexTrack[] = []
      let plexObservationKind: ReturnType<typeof classifyPlexPlaylistObservation> = 'initial'
      if (source.plexPlaylistRatingKey) {
        await initPlexClient(cfg.plex)
        const staleRatingKey = source.plexPlaylistRatingKey
        const snapshot = await getPlaylistSnapshotByRatingKey(staleRatingKey, 99999)
        if (snapshot) {
          observedPlexTracks = snapshot.tracks
          plexUpdatedAt = snapshot.updatedAt
          observedPlexFingerprint = buildPlexPlaylistFingerprint(snapshot.tracks)
          observedPlexPaths = buildPlexPathSnapshot(snapshot.tracks)
          plexObservationKind = classifyPlexPlaylistObservation(observedPlexFingerprint, {
            lastObservedPlexFingerprint: source.lastObservedPlexFingerprint,
            lastAppliedPlexFingerprint: source.lastAppliedPlexFingerprint,
          })
          if (plexRecoveryOnly && (observedPlexFingerprint !== recoverySnapshot?.plexFingerprint
            || observedPlexFingerprint !== (source.lastAppliedPlexFingerprint ?? source.lastObservedPlexFingerprint))) {
            const summary = 'Plex 歌单已发生外部变化，索引恢复已延后，等待正常同步'
            job.finishStep(s1, 'skipped', summary)
            return { kind: 'deferred', reason: 'plex_recovery', status: 'success', failedSongs: 0, summary }
          }
        } else {
          if (plexRecoveryOnly) {
            const summary = 'Plex 歌单已不存在，索引恢复已延后，等待正常同步'
            job.finishStep(s1, 'skipped', summary)
            return { kind: 'deferred', reason: 'plex_recovery', status: 'success', failedSongs: 0, summary }
          }
          if (getSource(source.id)?.plexPlaylistRatingKey !== staleRatingKey) throw new Error('Plex 目标歌单在读取期间已被修改，本轮未清空新目标，请重新同步')
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
      const unavailableBindings = pruneUnavailableSongBindings(
        getActiveSongIdentityBindings(currentIdOrder).values(), observedPlexTracks, cfg, dryRun,
      )
      if (unavailableBindings.size > 0) source.requiresMatchReconcile = true
      const missingMediaPolicyEnabled = !plexRecoveryOnly && mode !== 'redownload_managed'
      const failurePolicy = getSourceFailurePolicy(source.id)
      const ignoredSongIds = new Set(Object.entries(failurePolicy.failuresBySongId)
        .filter(([id, failure]) => shouldDeferFailure(failure, cfg.sync.maxFailureAttempts) && !retrySongIds.has(Number(id)))
        .map(([id]) => Number(id)))
      const missingMediaWorkDetected = missingMediaPolicyEnabled
        && [...planMissingMedia(yunSongs, cfg, { validateAudio: false }).values()].some(plan =>
          !['manual_exempt', 'reuse_managed', 'wait_manual'].includes(plan.disposition)
          && !shouldDeferFailure(failurePolicy.failuresBySongId[plan.songId], cfg.sync.maxFailureAttempts),
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
        return { kind: 'unchanged', status: unchangedStatus, failedSongs: 0,
          summary: source.lastError ?? '来源未变化，复用上次结果；本轮未逐首核对' }
      }

      const finalization = { source, config: cfg, job, dryRun, skipRemoveExtra,
        authoritativeTrackCount, currentIdOrder, trackUpdateTime, plexUpdatedAt }
      // Pure reorder: skip download, just reorder Plex playlist
      if (!plexRecoveryOnly && sourceFailureStatus !== 'open' && Object.keys(failurePolicy.failuresBySongId).length === 0 && Object.keys(failurePolicy.removalFailures).length === 0
        && det.isPureReorder && !det.needFullCompare && missingSongDetailIds.length === 0) {
        const reordered = await tryApplyPureSourceReorder({
          source,
          songs: yunSongs,
          config: cfg,
          job,
          stepContext,
          dryRun,
          currentIdOrder,
          isCancellationRequested: () => input.signal.aborted,
          throwIfCancelled,
          setStage,
          log: (level, message) => log(level, message),
          onProgress: observer.playlistProgress,
        })
        if (reordered) {
          return await finalizeSourceConvergence({ ...finalization, ...reordered, fullVerification: false, neteaseCursor })
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
      const { resolutions: comparedResolutions, plexPlaylist: plexPlaylistResult, sectionKey, extraTracks } = await reconcileSource(
        source, yunSongs, cfg, job, splitArtists,
        () => input.signal.aborted,
        skipPlexPL,
        dryRun,
        {
          automaticMediaFallback: missingMediaPolicyEnabled,
          requireExistingPlaylist: plexRecoveryOnly,
          trustedSongIds,
          ignoredSongIds,
          neteaseIndices: songIndices,
        },
      )
      throwIfCancelled()
      const bindingVersionSnapshot = captureBindingVersions(currentIdOrder)
      const completionIdentity = captureSourceConvergenceCheckpoint(currentIdOrder)
      const plexPlaylist = plexPlaylistResult
      if (plexRecoveryOnly && (comparedResolutions.some(item => ['needs_download', 'unavailable'].includes(item.resolution))
        || !comparedResolutions.some(item => item.resolution === 'found_in_plex_library'))) {
        const summary = '暂无可安全补齐的媒体，等待正常同步；本次不下载或扫描'
        job.finishStep(job.startStep('compare', '核对迟到入库的托管文件'), 'skipped', summary)
        return { kind: 'deferred', reason: 'plex_recovery', status: 'success', failedSongs: 0, summary }
      }
      // Register outcomes only after the comparison is safe to apply.
      const allSongs = yunSongs.map((s, index) => ({
        songName: s.name,
        artist: joinArtist(s.artists),
        album: s.album.name,
        status: 'pending' as SongStatus,
        neteaseSongId: s.id,
        neteaseIndex: songIndices[index]!,
      }))
      job.addSongs(source.id, allSongs)
      addMissingDetailSongs(job, source.id, missingSongDetailIds, failurePolicy, currentIdOrder)

      if (!dryRun) {
        recordSourceComparison(source.id, {
          neteaseCursor,
          plexFingerprint: observedPlexFingerprint,
        })
      }

      // Update job song statuses from TrackResolution results
      for (const r of comparedResolutions) {
        const deferredFailure = r.resolution === 'ignored_failure'
          ? failurePolicy.failuresBySongId[r.song.id]
          : undefined
        const mediaConflict = getOpenMediaIdentityConflict(deferredFailure)
        if (mediaConflict) {
          markMediaIdentityConflictAwaitingManual(r, mediaConflict.message)
        }
        const songId = job.findSongIdByIndex(source.id, r.neteaseIndex)
          ?? job.findSongId(source.id, r.song.id)
        if (!songId) continue
        if (r.matchTrace) {
          job.updateSong(songId, { metadata: { matchTrace: { ...r.matchTrace } } })
        }
        if (r.resolution === 'unavailable') {
          job.updateSong(songId, { status: 'failed_plex_match', phase: 'plex_match', error: {
            title: '媒体身份冲突', message: r.matchTrace?.message ?? 'Plex 媒体身份不唯一，无法安全选择',
            code: 'media_identity_conflict', stage: 'plex_match', songName: r.song.name, artist: splitArtists(r.song.artists)[0],
          } })
        } else if (mediaConflict) {
          job.updateSong(songId, {
            status: 'awaiting_manual_match',
            phase: mediaConflict.phase,
            error: {
              title: '媒体身份冲突',
              message: mediaConflict.message,
              code: 'media_identity_conflict',
              stage: mediaConflict.phase,
              songName: r.song.name,
              artist: splitArtists(r.song.artists)[0],
            },
          })
        } else if (r.resolution === 'ignored_failure') {
          job.updateSong(songId, { status: deferredFailure?.status === 'ignored' ? 'ignored_failure' : 'awaiting_retry', phase: deferredFailure?.phase || 'download' })
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
            playlistRatingKey: plexPlaylist.ratingKey,
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

      const downloads: SourceDownloadResult = plexRecoveryOnly
        ? { resolutions: comparedResolutions, needsPlexRefresh: false, downloadTargetCount: 0 }
        : await applySourceDownloads({
            source,
            resolutions: comparedResolutions,
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

      let checkpoint = captureSourceConvergenceCheckpoint(currentIdOrder, completionIdentity)
      if (!dryRun && !skipPlexPL) {
        checkpoint = await reconcilePlexPlaylist({
          source,
          resolutions: downloads.resolutions,
          extraTaskIds,
          config: cfg,
          job,
          stepContext,
          plexPlaylist,
          sectionKey,
          currentIdOrder,
          bindingVersionSnapshot,
          bindingRatingKeys: completionIdentity.plexRatingKeys,
          emptyTargetConfirmed,
          skipRemoveExtra,
          retryUnresolvedSnapshot: plexRecoveryOnly || retryUnresolvedSnapshot,
          needsPlexRefresh: downloads.needsPlexRefresh,
          ...(plexRecoveryOnly ? {
            expectedPlexFingerprint: observedPlexFingerprint!,
            assertRecoveryContextUnchanged: () => {
              const latestConfig = readCurrentConfig()
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
          isCancellationRequested: () => input.signal.aborted,
          throwIfCancelled,
          setStage,
          log,
          onProgress: observer.playlistProgress,
        })
      }

      const sourceResult = await finalizeSourceConvergence({
        ...finalization, checkpoint,
        fullVerification: trustedSongIds.size === 0,
        plexPlaylist,
      })
      return sourceResult
    } catch (error) {
      if (input.signal.aborted || error instanceof CancellationError) {
        if (!dryRun) updateSource(source.id, { requiresMatchReconcile: true })
        throw new CancellationError()
      }
      const result = recordSourceConvergenceFailure({ source, job, context: stepContext, error,
        stage, dryRun, authoritativeTrackCount: sourceTrackCount })
      log('error', `歌单「${source.name}」同步失败: ${result.summary}`)
      return result
    }
  })
}
