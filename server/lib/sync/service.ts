import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, fetchPlaylistSongs, fetchAlbumSongs, clearAlbumCache, setArtistAliases } from '../netease'
import { configureResolver } from './artist-resolver'
import { getPlaylistTracks, getPlaylistUpdatedAt, initPlexClient, findPlaylist, getPlaylistByRatingKey, getSectionKey } from '../plex-client'
import { RunBuilder } from '../run/builder'
import { cleanupOldRuns, saveSyncRun } from '../run/store'
import type { SongStatus } from '../job/types'
import { getEnabledSources, listSources, updateSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { buildDownloadTaskIdempotencyKey, enqueueTask, processAll, cleanupOldDownloadTasks, getDownloadTask } from '../download/queue'
import type { DownloadTask } from '../download/queue'
import { downloadSingleSong } from '../download/single-song'
import { emitEvent } from './events'
import { reconcileSource, triggerRescan, findTrackWithRetryDetailed, applyFullReorder } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'
import { deleteSongLookups, getSongLookupRatingKeys } from './song-lookup-store'
import { buildCachedTargetOrder } from './reorder-cache'
import { recordActivityEvent } from '../activity/store'
import { getFailureMemoryEntry, inferFailurePhase, parseFailureMemory, recordFailure, removeFailures, serializeFailureMemory, shouldSkipSongDueToFailure } from './failure-memory'
import { describePlexMatchFailure, inferPlexMatchFailureCause } from './plex-match'
import { classifyDownloadTaskFailure, shouldAttemptPlexRetryForResolution } from './download-diagnostics'
import { findExistingLocalSongPath } from './local-file-discovery'
import { CancellationError, createInitialState, STAGE_LABELS, type SyncRunOptions } from './service-state'
import { buildSyncRunSummary, recordSyncRunCompletion } from './service-summary'
import { PlexReorderError } from './reorder'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'

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

  async function runSync(options?: SyncRunOptions): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')

    clearAlbumCache()

    const dryRun = options?.dryRun ?? false
    const targetIds = options?.sourceIds
    const rebuildMatch = options?.rebuildMatch ?? false
    cancelRequested = false
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = new RunBuilder(dryRun)
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
      let totalSuccess = 0
      let totalFailed = 0

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

          const { songs: yunSongs, trackUpdateTime: rawTrackUpdateTime, trackIds, playlistName: nePlaylistName } = source.type === 'album'
            ? { songs: await fetchAlbumSongs(playlistId, cfg.netease.cookie), trackUpdateTime: null, trackIds: [], playlistName: source.neteasePlaylistName }
            : await fetchPlaylistSongs(playlistId, sourceSongLimit, cfg.netease.cookie)
          throwIfCancelled()
          const trackUpdateTime = rawTrackUpdateTime

          // Detect Netease playlist rename
          if (nePlaylistName && nePlaylistName !== source.neteasePlaylistName) {
            log('info', `歌单名称已更改: 「${source.neteasePlaylistName}」→「${nePlaylistName}」`)
            if (!dryRun) updateSource(source.id, { neteasePlaylistName: nePlaylistName })
            source.neteasePlaylistName = nePlaylistName
          }

          let plexUpdatedAt: number | null = null
          if (source.plexPlaylistRatingKey) {
            await initPlexClient(cfg.plex)
            plexUpdatedAt = await getPlaylistUpdatedAt(source.plexPlaylistRatingKey)
          }

          const currentIdOrder = trackIds.map(t => t.id)
          const det = detectChanges({
            isAlbum,
            trackUpdateTime,
            lastTrackUpdateTime: source.lastTrackUpdateTime,
            manualForce: rebuildMatch || options?.forceFull || cfg.sync.forceFullCompare || source.forceFullCompare || false,
            dryRun,
            consecutiveSkips: source.consecutiveSkips || 0,
            fullCompareAfterSkips: source.fullCompareAfterSkips ?? cfg.sync.fullCompareAfterSkips,
            fullCompareAfterDays: source.fullCompareAfterDays ?? cfg.sync.fullCompareAfterDays,
            lastFullCompareAt: source.lastFullCompareAt,
            currentIdOrder,
            trackIdSnapshot: source.trackIdSnapshot,
          })

          job.finishStep(s1, 'success', `歌单获取完成，共 ${yunSongs.length} 首（${det.changedMsg}${det.diffMsg ? '，' + det.diffMsg : ''}）`)

          if (rebuildMatch && !dryRun) {
            const removed = deleteSongLookups(currentIdOrder)
            log('info', `歌单「${playlistName}」已清理 ${removed} 条匹配缓存，开始重建缓存后全量同步`)
          }

          // Skip entirely if Netease unchanged
          if (det.skipEntirely) {
            log('info', `歌单「${playlistName}」未变化，跳过对比（连续跳过 ${(source.consecutiveSkips || 0) + 1} 次）`)
            updateSource(source.id, {
              lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null,
              lastJobId: job.getId(), trackCount: yunSongs.length,
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
            continue
          }

          if (det.autoForce) log('info', `歌单「${playlistName}」触发自动全量对比（超过${cfg.sync.fullCompareAfterSkips > 0 ? '跳过次数' : '时间间隔'}）`)

          // Pure reorder: skip download, just reorder Plex playlist
          if (det.isPureReorder && !det.needFullCompare) {
            log('info', `歌单「${playlistName}」仅顺序变化，跳过下载直接重排`)
            const cacheKeys = getSongLookupRatingKeys(currentIdOrder)
            const targetOrder = buildCachedTargetOrder(currentIdOrder, cacheKeys)
            if (!targetOrder) {
              log('warn', `歌单「${playlistName}」纯重排缓存不完整，回退到完整对比`)
            } else {
              const allSongs = yunSongs.map(s => ({
                songName: s.name,
                artist: joinArtist(s.artists),
                album: s.album.name,
                status: 'skipped_existing' as SongStatus,
                neteaseSongId: s.id,
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
                  try {
                    await applyFullReorder(pp.ratingKey, targetOrder, currentItems, sk, () => cancelRequested, (lvl, msg) => log(lvl as 'info'|'warn'|'error', msg), skipRemoveExtra)
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
                  }
                  throwIfCancelled()
                }
              }
              if (!dryRun) updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null, lastJobId: job.getId(), trackCount: yunSongs.length, lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt, consecutiveSkips: 0, lastFullCompareAt: new Date().toISOString(), trackIdSnapshot: JSON.stringify(currentIdOrder) })
              totalSuccess += yunSongs.length
              continue
            }
          }

          if (yunSongs.length === 0) {
            log('info', `歌单「${playlistName}」为空，跳过当前来源`)
            if (!dryRun) {
              updateSource(source.id, {
                lastSyncedAt: new Date().toISOString(),
                lastStatus: 'success',
                lastError: null,
                lastJobId: job.getId(),
                trackCount: 0,
                lastTrackUpdateTime: trackUpdateTime,
                consecutiveSkips: 0,
                lastFullCompareAt: new Date().toISOString(),
                trackIdSnapshot: JSON.stringify(currentIdOrder),
              })
            }
            continue
          }

          // Register all songs to job
          const allSongs = yunSongs.map((s) => ({
            songName: s.name,
            artist: joinArtist(s.artists),
            album: s.album.name,
            status: 'pending' as SongStatus,
            neteaseSongId: s.id,
          }))
          job.addSongs(source.id, allSongs)

          // ── Step 2a: Filter known ignored/copyright-restricted songs before Plex lookup ──
          const knownRestricted: number[] = source.copyrightRestrictedIds
            ? JSON.parse(source.copyrightRestrictedIds)
            : []
          const failureMemory = parseFailureMemory(source.ignoredFailureIds)
          const maxFailures = cfg.sync.maxFailureAttempts

          const songsToReconcile = yunSongs.filter((s) => {
            if (knownRestricted.includes(s.id)) {
              const songId = job.findSongId(source.id, s.id)
              if (songId) job.updateSong(songId, { status: 'copyright_restricted', phase: 'download' })
              return false
            }
            if (shouldSkipSongDueToFailure(failureMemory, s.id, maxFailures)) {
              if (findExistingLocalSongPath(s, cfg)) {
                return true
              }
              const songId = job.findSongId(source.id, s.id)
              const entry = getFailureMemoryEntry(failureMemory, s.id)
              if (songId) job.updateSong(songId, {
                status: 'ignored_failure',
                phase: inferFailurePhase(s.id, entry),
              })
              return false
            }
            return true
          })
          const ignoredBeforeReconcile = yunSongs.length - songsToReconcile.length
          if (ignoredBeforeReconcile > 0) {
            log('info', `跳过 ${ignoredBeforeReconcile} 首已缓存忽略/版权的歌曲，不进行 Plex 查找`)
          }

          // ── Step 2b: Reconcile (tiered lookup: DB → Plex → disk → download) ──
          setStage('comparing')
          log('info', '连接 Plex...')

          const { resolutions, plexPlaylist: plexPlaylistResult, sectionKey, extraTracks } = await reconcileSource(
            source, songsToReconcile, cfg, job, splitArtists,
            () => cancelRequested,
            (lvl, msg) => log(lvl as 'info' | 'warn' | 'error', msg),
            skipPlexPL,
            dryRun,
          )
          throwIfCancelled()
          const plexPlaylist = plexPlaylistResult

          // Update job song statuses from TrackResolution results
          for (const r of resolutions) {
            const songId = job.findSongId(source.id, r.song.id)
            if (!songId) continue
            if (r.resolution === 'matched_plex_playlist' || r.resolution === 'found_in_plex_library') {
              job.updateSong(songId, { status: 'skipped_existing', phase: 'done' })
            } else if (r.resolution === 'unavailable') {
              job.updateSong(songId, { status: 'failed_download', phase: 'download', error: { title: '歌曲不可用', message: '网易云无下载链接', stage: 'download', songName: r.song.name, artist: splitArtists(r.song.artists)[0] } })
            }
            // needs_download / found_on_disk stay pending
          }

          // Register removed tracks (in Plex playlist but not Netease)
          if (!skipRemoveExtra) {
            for (const xt of extraTracks) {
              job.addSongs(source.id, [{
                songName: xt.title,
                artist: xt.artist,
                album: xt.album,
                status: 'removed' as SongStatus,
              }])
              const songId = job.findRemovedSongId(source.id, xt.title, xt.artist, xt.album)
              if (songId) job.updateSong(songId, { phase: 'done' })
            }
          }

          // ── Step 3: Collect songs needing download (caches already applied in Step 2a) ──
          const songsToDownload = resolutions.filter((r) => r.resolution === 'needs_download')

          const songsOnDisk = resolutions.filter((r) => r.resolution === 'found_on_disk')
          const needsRefresh = songsToDownload.length > 0 || songsOnDisk.length > 0
          const queuedDownloadTasks = new Map<number, DownloadTask>()

          if (!dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', '下载歌曲', { context: stepContext })
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
                  quality: cfg.netease.quality,
                  downloadDir: cfg.download.dir,
                  pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
                }),
              })
              queuedDownloadTasks.set(r.song.id, task)
            }

            const processor = async (task: DownloadTask, onProgress: (pct: number) => void) => {
              throwIfCancelled()
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
                downloadMode: 'full',
              }, onProgress)
            }

            await processAll(processor, undefined, cfg.sync.downloadConcurrency || 3, [...queuedDownloadTasks.values()].map(task => task.id))
            throwIfCancelled()
            setStage('processing_tags')

            for (const r of songsToDownload) {
              const songId = job.findSongId(source.id, r.song.id)
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
                r.filePath = task.filePath ?? r.filePath
                job.updateSong(songId, {
                  status: 'success', phase: 'done',
                  filePath: task.filePath, fileType: task.fileType,
                  metadata: { trackNumber: r.song.no, quality: cfg.netease.quality, duration: r.song.dt, disc: r.song.disc || '1' },
                })
              }
            }

            const okCount = songsToDownload.filter((r) => {
              const js = job.getSong(source.id, r.song.id)
              return js?.status === 'success'
            }).length
            const failCount = songsToDownload.length - okCount
            log('info', `下载完成: ${okCount} 成功, ${failCount} 失败`)
            job.finishStep(s3, failCount > 0 ? 'partial' : 'success', `${okCount} 首成功，${failCount} 首失败`)
          } else if (dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', '下载歌曲', { context: stepContext })
            for (const r of songsToDownload) {
              log('info', `[预览] 将下载: ${r.song.name}`)
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
            const targetOrder: string[] = []
            const plexMatchResults = new Map<number, Awaited<ReturnType<typeof findTrackWithRetryDetailed>>>()
            const failedPlexRetrySongIds: number[] = []

            for (const r of resolutions) {
              throwIfCancelled()
              const sid = job.findSongId(source.id, r.song.id)
              const currentSong = sid ? job.getSong(source.id, r.song.id) : null
              const effectiveStatus = currentSong?.status
              const effectiveFilePath = currentSong?.filePath ?? r.filePath
              if (effectiveFilePath && !r.filePath) r.filePath = effectiveFilePath

              if (shouldAttemptPlexRetryForResolution(r.resolution, effectiveStatus, effectiveFilePath)) {
                const result = await findTrackWithRetryDetailed(
                  sectionKey,
                  r.song,
                  cfg,
                  effectiveFilePath,
                  cfg.sync.plexScanRetries,
                  cfg.sync.plexScanRetryDelaySec * 1000,
                )
                if (result.ratingKey) {
                  r.plexRatingKey = result.ratingKey
                  r.resolution = 'found_in_plex_library'
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
              if (r.plexRatingKey) targetOrder.push(r.plexRatingKey)
            }

            for (const r of resolutions) {
              const result = plexMatchResults.get(r.song.id)
              if (!result) continue

              const cause = inferPlexMatchFailureCause(result, {
                downloadedSongs: songsToDownload.length,
                failedDownloadedSongs: failedPlexRetrySongIds.length,
              })
              const sid = job.findSongId(source.id, r.song.id)
              if (!sid) continue
              const currentSong = job.getSong(source.id, r.song.id)
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

            // Fetch current playlist items for the LCS
            const currentItems = (await getPlaylistTracks(plexPlaylist.ratingKey, 99999))
              .filter((t) => t.playlistItemID)
              .map((t) => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))
            const hasIncompleteTargetOrder = resolutions.some((r) =>
              !['copyright_restricted', 'unavailable'].includes(r.resolution)
              && !r.plexRatingKey,
            )
            const shouldSkipRemoveForSafety = skipRemoveExtra || hasIncompleteTargetOrder
            if (hasIncompleteTargetOrder && !skipRemoveExtra) {
              log('warn', `歌单「${playlistName}」仍有歌曲未解析到 Plex，已跳过删除 Plex 多余歌曲以避免误删`)
            }

            try {
              await applyFullReorder(
                plexPlaylist.ratingKey, targetOrder, currentItems, sectionKey,
                () => cancelRequested,
                (lvl, msg) => log(lvl as 'info' | 'warn' | 'error', msg),
                shouldSkipRemoveForSafety,
              )
            } catch (err) {
              if (err instanceof PlexReorderError) {
                const ratingKeyToSongId = new Map<string, string>()
                for (const r of resolutions) {
                  if (!r.plexRatingKey) continue
                  const taskSongId = job.findSongId(source.id, r.song.id)
                  if (taskSongId) ratingKeyToSongId.set(r.plexRatingKey, taskSongId)
                }

                const playlistItemIdToRemovedSongId = new Map<number, string>()
                for (const xt of extraTracks) {
                  const removedSongId = job.findRemovedSongId(source.id, xt.title, xt.artist, xt.album)
                  if (removedSongId) playlistItemIdToRemovedSongId.set(xt.playlistItemId, removedSongId)
                }

                markPlexReorderFailures(job, err.result.failures, {
                  ratingKeyToSongId,
                  playlistItemIdToRatingKey: new Map(currentItems.map(item => [item.playlistItemId, item.ratingKey])),
                  playlistItemIdToRemovedSongId,
                })
                job.failStep(s4, 'Plex 歌单重排失败', buildPlexReorderStepError(err))
              }
              throw err
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
          const failCount = job.getRun().songs.filter((s) =>
            ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status) && s.sourceId === source.id,
          ).length
          const restrictedCount = job.getRun().songs.filter((s) => s.status === 'copyright_restricted' && s.sourceId === source.id).length
          const ignoredCount = job.getRun().songs.filter((s) => s.status === 'ignored_failure' && s.sourceId === source.id).length

          let sourceStatus: PlaylistSource['lastStatus'] = 'success'
          if (failCount > 0 && succCount > 0) sourceStatus = 'partial'
          else if (failCount > 0 && succCount === 0) sourceStatus = 'failed'

          // Re-fetch plexUpdatedAt after reorder (playlist was modified)
          let finalPlexUpdatedAt = plexUpdatedAt
          if (plexPlaylist?.ratingKey) {
            finalPlexUpdatedAt = await getPlaylistUpdatedAt(plexPlaylist.ratingKey)
          }

          if (!dryRun) {
            const sourceUpdate: Parameters<typeof updateSource>[1] = {
              lastSyncedAt: new Date().toISOString(),
              lastStatus: sourceStatus,
              lastError: failCount > 0 ? `${failCount} 首失败`
                : restrictedCount > 0 || ignoredCount > 0
                  ? `${[restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '', ignoredCount > 0 ? `${ignoredCount} 首已忽略` : ''].filter(Boolean).join('，')}`
                  : null,
              lastJobId: job.getId(),
              trackCount: yunSongs.length,
              plexPlaylistRatingKey: plexPlaylist?.ratingKey || '',
              plexUpdatedAt: finalPlexUpdatedAt,
              consecutiveSkips: 0,
            }
            if (sourceStatus === 'success') {
              sourceUpdate.lastTrackUpdateTime = trackUpdateTime
              sourceUpdate.lastFullCompareAt = new Date().toISOString()
              sourceUpdate.trackIdSnapshot = JSON.stringify(currentIdOrder)
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

          totalSuccess += succCount
          totalFailed += failCount

          const parts = [`${succCount} 成功`]
          if (failCount > 0) parts.push(`${failCount} 失败`)
          if (restrictedCount > 0) parts.push(`${restrictedCount} 版权受限`)
          if (ignoredCount > 0) parts.push(`${ignoredCount} 已忽略`)
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
              failedSongs: failCount,
              restrictedSongs: restrictedCount,
              ignoredSongs: ignoredCount,
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
    }
  }

  // ── Overall finalize ──
  const jobStatus: 'success' | 'partial' | 'failed' =
    totalFailed === 0 ? 'success' :
    totalSuccess > 0 ? 'partial' : 'failed'

  const finishedJob = job.finish(jobStatus, '')
  const summary = buildSyncRunSummary({ job: finishedJob, sourceCount: sources.length, dryRun, rebuildMatch })
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

  async function runSyncForSource(sourceId: string, options?: { dryRun?: boolean; forceFull?: boolean; rebuildMatch?: boolean; trigger?: 'user' | 'system' | 'retry' }): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    return runSync({ dryRun: options?.dryRun, sourceIds: [sourceId], forceFull: options?.forceFull, rebuildMatch: options?.rebuildMatch, trigger: options?.trigger })
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

  return { getState, runSync, runSyncForSource, cancelSync }
}
