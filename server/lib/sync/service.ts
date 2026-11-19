import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { clearAlbumCache } from '../netease'
import { RunBuilder } from '../run/builder'
import { cancelRunDownloads } from '../download/queue-control'
import { saveSyncRun } from '../run/store'
import { getEnabledSources, listSources } from '../playlist/store'
import { emitEvent } from './events'
import { resolveSyncModePolicy } from './mode-policy'
import { CancellationError, createInitialState, STAGE_LABELS, type SyncRunOptions } from './service-state'
import { buildSyncRunSummary } from './service-summary'
import { executeSourceConvergence } from './source-convergence'
import { assertSourcesReadyForConvergence } from '../source-initialization/gate'

export { STAGE_LABELS } from './service-state'

export function getSyncService(getConfig: () => AppConfig) {
  let state = createInitialState()
  let cancelRequested = false
  let currentSourceName = ''
  let currentSourceId: string | null = null
  let currentRun: RunBuilder | null = null
  let requestController: AbortController | null = null

  function getState(): SyncState {
    return { ...state, currentRunId: currentRun?.getId() ?? null }
  }

  function getCurrentRun() {
    if (!currentRun || state.dryRun) return null
    const run = currentRun.getRun()
    return {
      ...run,
      durationMs: Date.now() - new Date(run.startedAt).getTime(),
      songs: run.songs.filter((song) => song.status !== 'skipped_existing'),
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
      return await executeSync(options, preparedJob, controller.signal)
    } finally {
      if (requestController === controller) requestController = null
    }
  }

  async function executeSync(
    options: SyncRunOptions | undefined,
    preparedJob: RunBuilder | undefined,
    signal: AbortSignal,
  ): Promise<SyncState> {
    clearAlbumCache()

    const mode = options?.mode ?? 'normal'
    const modePolicy = resolveSyncModePolicy(mode)
    const dryRun = modePolicy.dryRun
    const targetIds = options?.sourceIds
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
      const allSources = getEnabledSources()
      const sources = targetIds
        ? listSources().filter((s) => targetIds.includes(s.id)) // manual trigger: include disabled (e.g. albums)
        : allSources
      if (sources.length === 0) throw new Error('没有可同步的歌单源，请在「歌单源」页面添加')
      assertSourcesReadyForConvergence(sources, globalConfig)

      // ── Validate ──
      if (!globalConfig.netease.cookie) throw new Error('未配置网易云 Cookie')
      if (!globalConfig.plex.server || !globalConfig.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')
      job.setSourceIds(sources.map((source) => source.id))
      if (!dryRun) saveSyncRun(job.getRun())

      // ── Sync each source ──
      let totalFailed = 0
      let successfulSources = 0
      let partialSources = 0
      let failedSources = 0
      let recoveryDeferredReason: string | null = null

      for (const source of sources) {
        throwIfCancelled()
        currentSourceId = source.id
        currentSourceName = source.name || `网易云歌单 #${source.neteasePlaylistId}`
        state.stageHistory = []
        const result = await executeSourceConvergence({
          source,
          config: globalConfig,
          job,
          signal,
          options: options ?? {},
          observer: { stage: setStage, failure: addFailure, log, playlistProgress: setPlaylistProgress },
          readCurrentConfig: getConfig,
        })
        throwIfCancelled()
        totalFailed += result.failedSongs
        if (result.status === 'success') successfulSources++
        else if (result.status === 'partial') partialSources++
        else failedSources++
        if (result.kind === 'deferred' && result.reason === 'plex_recovery') recoveryDeferredReason = result.summary
      }

      // ── Overall finalize ──
      const jobStatus: 'success' | 'partial' | 'failed' =
        failedSources > 0 && successfulSources === 0 && partialSources === 0
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
      }

      finishState(jobStatus === 'failed' ? 'failure' : jobStatus)
      return { ...state }
    } catch (err) {
      if (cancelRequested || err instanceof CancellationError) {
        const j =
          state.cancellationReason === 'shutdown'
            ? job.finish('failed', '任务因服务停止中断')
            : job.finish('cancelled', '用户取消；已确认的文件和 Plex 变更已保留，未完成部分下次继续核对')
        if (!dryRun) saveSyncRun(j)
        finishState(null)
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

  function prepareSyncForSource(
    sourceId: string,
    options?: SyncRunOptions,
  ): {
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

  function cancelSync(reason: 'user' | 'shutdown' = 'user'): boolean {
    if (!state.isRunning) return false
    cancelRequested = true
    state.cancellationReason ??= reason
    if (currentRun && state.cancellationReason === 'user') cancelRunDownloads(currentRun.getId())
    requestController?.abort(new CancellationError())
    return true
  }

  function setStage(stage: SyncState['currentStage']) {
    if (stage === 'fetching_playlist' || stage === 'idle') state.playlistProgress = null
    state.currentStage = stage
    if (!['downloading', 'processing_tags'].includes(stage)) state.currentSong = null
    const history = (state.stageHistory ??= [])
    if (!history.includes(stage)) history.push(stage)
    state.currentSourceName = currentSourceName || null
    emitEvent({
      type: 'stage-change',
      data: {
        stage,
        stageHistory: [...history],
        label: STAGE_LABELS[stage] || stage,
        sourceName: currentSourceName,
        sourceId: currentSourceId,
      },
      timestamp: new Date().toISOString(),
    })
    if (currentRun && !state.dryRun) saveSyncRun(currentRun.getRun())
  }
  function addFailure(songName: string, reason: string) {
    state.failures.push({ songName, reason, timestamp: new Date().toISOString() })
  }
  let lastPlaylistEvent = 0
  function setPlaylistProgress(value: NonNullable<SyncState['playlistProgress']>) {
    const previous = state.playlistProgress
    state.playlistProgress = { ...value }
    const now = Date.now()
    if ((!previous || previous.phase !== value.phase || previous.batch !== value.batch || previous.confirmed !== value.confirmed)
      && currentRun && !state.dryRun) saveSyncRun(currentRun.getRun())
    if (previous?.phase !== value.phase || previous.batch !== value.batch || now - lastPlaylistEvent >= 250 || value.confirmed === value.total) {
      lastPlaylistEvent = now
      emitEvent({ type: 'playlist-progress', data: { stage: state.currentStage, playlistProgress: { ...value } }, timestamp: new Date(now).toISOString() })
    }
  }
  function finishState(result: SyncState['lastSyncResult']) {
    state.lastSyncAt = new Date().toISOString()
    state.lastSyncResult = result
    if (result) state.syncCount++
    if (result === 'success') state.successCount++
    else if (result === 'failure') state.failureCount++
    state.isRunning = false
    state.currentStage = 'idle'
    state.currentSourceName = null
    state.progress = null
    state.playlistProgress = null
    state.currentSong = null
    emitEvent({
      type: 'stage-change',
      data: { stage: 'idle', label: '空闲', sourceName: currentSourceName, sourceId: currentSourceId },
      timestamp: new Date().toISOString(),
    })
  }

  return {
    getState,
    getCurrentRun,
    runSync,
    runSyncForSource,
    prepareSyncForSource,
    startSync,
    startSyncForSource,
    cancelSync,
  }
}
