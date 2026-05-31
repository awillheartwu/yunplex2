import { getDb } from '../db'
import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, fetchPlaylistSongs, fetchAlbumSongs, clearAlbumCache } from '../netease'
import { getPlaylistTracks } from '../plex-client'
import { JobBuilder } from '../job/builder'
import { saveJob, cleanupOldJobs } from '../job/store'
import type { SongStatus } from '../job/types'
import { getEnabledSources, listSources, updateSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { enqueueTask, processAll, listDownloadTasks, cleanupOldDownloadTasks } from '../download/queue'
import type { DownloadTask } from '../download/queue'
import { downloadSingleSong } from '../download/single-song'
import { emitEvent } from './events'
import { reconcileSource, triggerRescan, findTrackWithRetry, applyFullReorder } from './plex-reconciler'
import { createSplitArtists, joinArtist } from './artist-utils'
import { detectChanges } from './change-detection'

export const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取源曲目',
  comparing: '对比歌曲',
  downloading: '下载歌曲',
  processing_tags: '写入元数据',
  refreshing_plex: '刷新 Plex 库',
  updating_plex_playlist: '更新 Plex 歌单',
  reorder: '重排歌单',
  cancelled: '已取消',
  error: '同步错误',
}

function createInitialState(): SyncState {
  return {
    isRunning: false, currentStage: 'idle', startedAt: null,
    lastSyncAt: null, lastSyncResult: null, syncCount: 0,
    successCount: 0, failureCount: 0, currentSong: null,
    progress: null, failures: [], dryRun: false,
  }
}

export function getSyncService(dataDir: string, getConfig: () => AppConfig) {
  let state = createInitialState()
  let cancelRequested = false
  let currentSourceName = ''

  function getState(): SyncState { return { ...state } }

  function log(level: 'info' | 'warn' | 'error', message: string, detail?: string) {
    const cfg = getConfig()
    const entry = appendLog(dataDir, { level, message, detail, stage: state.currentStage }, cfg.sync.logRetentionDays ?? 30)
    emitEvent({
      type: 'log',
      data: { id: entry.id, level, message, detail, stage: entry.stage, timestamp: entry.timestamp },
      timestamp: entry.timestamp,
    })
  }

  async function runSync(options?: { dryRun?: boolean; sourceIds?: string[]; forceFull?: boolean }): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')

    clearAlbumCache()

    const dryRun = options?.dryRun ?? false
    const targetIds = options?.sourceIds
    cancelRequested = false
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = new JobBuilder(dryRun)

    try {
      const cfg = getConfig()
      const cleanedJobs = cleanupOldJobs(cfg.sync.jobRetentionSuccessDays ?? 7, cfg.sync.jobRetentionFailedDays ?? 90)
      const cleanedTasks = cleanupOldDownloadTasks(cfg.sync.downloadTaskRetentionDays ?? 30)
      if (cleanedJobs > 0 || cleanedTasks > 0) {
        const parts: string[] = []
        if (cleanedJobs > 0) parts.push(`${cleanedJobs} 条旧任务`)
        if (cleanedTasks > 0) parts.push(`${cleanedTasks} 条下载队列`)
        log('info', `清理过期数据: ${parts.join('、')}`)
      }
      const multiFormat = cfg.other?.multiArtistFormat ?? 'ampersand'
      const splitArtists = createSplitArtists(multiFormat)

      // ── Validate ──
      if (!cfg.netease.cookie) throw new Error('未配置网易云 Cookie')
      if (!cfg.plex.server || !cfg.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')

      const allSources = getEnabledSources()
      const sources = targetIds
        ? listSources().filter((s) => targetIds.includes(s.id)) // manual trigger: include disabled (e.g. albums)
        : allSources
      if (sources.length === 0) throw new Error('没有可同步的歌单源，请在「歌单源」页面添加')

      // ── Sync each source ──
      let totalSuccess = 0
      let totalFailed = 0

      for (const source of sources) {
        if (cancelRequested) break
        currentSourceName = source.name || `网易云歌单 #${source.neteasePlaylistId}`
        const rawLimit = source.syncLimit ?? cfg.sync.songLimit
        const sourceSongLimit = rawLimit === 0 ? undefined : rawLimit
        const playlistId = source.neteasePlaylistId
        const playlistName = currentSourceName
        const isAlbum = source.type === 'album'
        const skipPlexPL = isAlbum && (source.skipPlexPlaylist || cfg.sync.skipPlexPlaylist)

        job.setConfig({
          playlistId,
          quality: cfg.netease.quality,
          server: cfg.plex.server,
          section: cfg.plex.section,
        })

        try {
          // ── Step 1: Fetch playlist ──
          const s1 = job.startStep('fetch_playlist', `获取${isAlbum ? '专辑' : '歌单'}: ${playlistName}`)
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
          const trackUpdateTime = rawTrackUpdateTime

          // Detect Netease playlist rename
          if (nePlaylistName && nePlaylistName !== source.neteasePlaylistName) {
            log('info', `歌单名称已更改: 「${source.neteasePlaylistName}」→「${nePlaylistName}」`)
            updateSource(source.id, { neteasePlaylistName: nePlaylistName })
            source.neteasePlaylistName = nePlaylistName
          }

          // ── Album: always full compare, no skip/incremental ──
          // (isAlbum and skipPlexPL declared above)

          // Get Plex playlist updatedAt for bilateral change detection
          let plexUpdatedAt: number | null = null
          if (source.plexPlaylistRatingKey) {
            try {
              const res = await fetch(`http://${cfg.plex.server}:${cfg.plex.port}/playlists/${source.plexPlaylistRatingKey}?X-Plex-Token=${cfg.plex.token}`)
              const xml = await res.text()
              const m = xml.match(/updatedAt="(\d+)"/)
              if (m) plexUpdatedAt = parseInt(m[1]!, 10)
            } catch { /* non-critical */ }
          }

          const currentIdOrder = trackIds.map(t => t.id)
          const det = detectChanges({
            isAlbum,
            trackUpdateTime,
            lastTrackUpdateTime: source.lastTrackUpdateTime,
            manualForce: options?.forceFull || cfg.sync.forceFullCompare || source.forceFullCompare || false,
            dryRun,
            consecutiveSkips: source.consecutiveSkips || 0,
            fullCompareAfterSkips: source.fullCompareAfterSkips ?? cfg.sync.fullCompareAfterSkips,
            fullCompareAfterDays: source.fullCompareAfterDays ?? cfg.sync.fullCompareAfterDays,
            lastFullCompareAt: source.lastFullCompareAt,
            currentIdOrder,
            trackIdSnapshot: source.trackIdSnapshot,
          })

          job.finishStep(s1, 'success', `歌单获取完成，共 ${yunSongs.length} 首（${det.changedMsg}${det.diffMsg ? '，' + det.diffMsg : ''}）`)

          // Skip entirely if Netease unchanged
          if (det.skipEntirely) {
            log('info', `歌单「${playlistName}」未变化，跳过对比（连续跳过 ${(source.consecutiveSkips || 0) + 1} 次）`)
            updateSource(source.id, {
              lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null,
              lastJobId: job.getId(), trackCount: yunSongs.length,
              lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt,
              consecutiveSkips: (source.consecutiveSkips || 0) + 1,
            })
            continue
          }

          if (det.autoForce) log('info', `歌单「${playlistName}」触发自动全量对比（超过${cfg.sync.fullCompareAfterSkips > 0 ? '跳过次数' : '时间间隔'}）`)

          // Pure reorder: skip download, just reorder Plex playlist
          if (det.isPureReorder && !det.needFullCompare) {
            log('info', `歌单「${playlistName}」仅顺序变化，跳过下载直接重排`)
            const allSongs = yunSongs.map(s => ({ songName: s.name, artist: joinArtist(s.artists), album: s.album.name, status: 'skipped_existing' as SongStatus }))
            job.addSongs(source.id, allSongs)
            for (const s of job.getJob().songs) {
              if (s.sourceId === source.id) job.updateSong(s.id, { status: 'skipped_existing', phase: 'done' })
            }
            // Quick-resolve Plex playlist for reorder
            if (!dryRun) {
              const { initPlexClient, findPlaylist, getPlaylistByRatingKey, getSectionKey } = await import('../plex-client')
              await initPlexClient(cfg.plex)
              let pp = source.plexPlaylistRatingKey ? await getPlaylistByRatingKey(source.plexPlaylistRatingKey) : null
              if (!pp) { const pn = source.plexPlaylistName || source.neteasePlaylistName; pp = await findPlaylist(pn) }
              if (pp) {
                const sk = (await getSectionKey(cfg.plex.section)) ?? ''
                const targetOrder: string[] = []
                const db = getDb()
                for (const s of yunSongs) {
                  const cached = db.prepare('SELECT plex_rating_key FROM song_lookup WHERE netease_song_id = ?').get(s.id) as { plex_rating_key: string } | undefined
                  if (cached?.plex_rating_key) targetOrder.push(cached.plex_rating_key)
                }
                if (targetOrder.length > 0) {
                  const currentItems = (await getPlaylistTracks(pp.ratingKey, 99999)).filter(t => t.playlistItemID).map(t => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))
                  await applyFullReorder(pp.ratingKey, targetOrder, currentItems, sk, () => cancelRequested, (lvl, msg) => log(lvl as 'info'|'warn'|'error', msg))
                }
              }
            }
            updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastStatus: 'success', lastError: null, lastJobId: job.getId(), trackCount: yunSongs.length, lastTrackUpdateTime: trackUpdateTime, plexUpdatedAt, consecutiveSkips: 0, lastFullCompareAt: new Date().toISOString(), trackIdSnapshot: JSON.stringify(currentIdOrder) })
            totalSuccess += yunSongs.length
            continue
          }

          if (yunSongs.length === 0) {
            const j = job.finish('success', '歌单为空，无需同步')
            saveJob(j)
            finishState('success')
            return { ...state }
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
          const failureMap: Record<number, number> = source.ignoredFailureIds
            ? JSON.parse(source.ignoredFailureIds)
            : {}
          const maxFailures = cfg.sync.maxFailureAttempts

          const songsToReconcile = yunSongs.filter((s) => {
            if (knownRestricted.includes(s.id)) {
              const songId = job.getJob().songs.find(
                (js) => js.songName === s.name && js.status === 'pending' && js.sourceId === source.id,
              )?.id
              if (songId) job.updateSong(songId, { status: 'copyright_restricted', phase: 'download' })
              return false
            }
            if ((failureMap[s.id] || 0) >= maxFailures) {
              const songId = job.getJob().songs.find(
                (js) => js.songName === s.name && js.status === 'pending' && js.sourceId === source.id,
              )?.id
              if (songId) job.updateSong(songId, { status: 'ignored_failure', phase: 'download' })
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
          )
          const plexPlaylist = plexPlaylistResult

          // Update job song statuses from TrackResolution results
          for (const r of resolutions) {
            const songId = job.getJob().songs.find(
              (s) => s.songName === r.song.name && s.status === 'pending' && s.sourceId === source.id,
            )?.id
            if (!songId) continue
            if (r.resolution === 'matched_plex_playlist' || r.resolution === 'found_in_plex_library') {
              job.updateSong(songId, { status: 'skipped_existing', phase: 'done' })
            } else if (r.resolution === 'unavailable') {
              job.updateSong(songId, { status: 'failed_download', phase: 'download', error: { title: '歌曲不可用', message: '网易云无下载链接', stage: 'download', songName: r.song.name, artist: splitArtists(r.song.artists)[0] } })
            }
            // needs_download / found_on_disk stay pending
          }

          // Register removed tracks (in Plex playlist but not Netease)
          for (const xt of extraTracks) {
            job.addSongs(source.id, [{
              songName: xt.title,
              artist: xt.artist,
              album: xt.album,
              status: 'removed' as SongStatus,
            }])
            const songId = job.getJob().songs.find(
              (s) => s.songName === xt.title && s.status === 'removed' && s.sourceId === source.id,
            )?.id
            if (songId) job.updateSong(songId, { phase: 'done' })
          }

          // ── Step 3: Collect songs needing download (caches already applied in Step 2a) ──
          const songsToDownload = resolutions.filter((r) => r.resolution === 'needs_download')

          const songsOnDisk = resolutions.filter((r) => r.resolution === 'found_on_disk')
          const needsRefresh = songsToDownload.length > 0 || songsOnDisk.length > 0

          if (!dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', '下载歌曲')
            setStage('downloading')
            log('info', `开始下载 ${songsToDownload.length} 首歌曲`)

            for (const r of songsToDownload) {
              const [, trackArtist] = splitArtists(r.song.artists)
              enqueueTask({
                sourceId: source.id,
                songId: r.song.id,
                songName: r.song.name,
                artist: trackArtist || splitArtists(r.song.artists)[0],
                album: r.song.album.name,
                quality: cfg.netease.quality,
                jobId: job.getId(),
              })
            }

            const processor = async (task: DownloadTask, onProgress: (pct: number) => void) => {
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

            await processAll(processor, job.getId(), cfg.sync.downloadConcurrency || 3)
            setStage('processing_tags')

            // Update job songs from queue
            const allTasks = listDownloadTasks({ status: undefined })
            for (const r of songsToDownload) {
              const songId = job.getJob().songs.find(
                (s) => s.songName === r.song.name && s.status === 'pending' && s.sourceId === source.id,
              )?.id
              if (!songId) continue

              const task = allTasks.items.find((t) => t.songId === r.song.id && t.jobId === job.getId())
              if (!task || task.status === 'failed') {
                const isCopyright = task?.error?.includes('无法获取歌曲') || task?.error?.includes('下载链接')
                const songStatus: SongStatus = isCopyright ? 'copyright_restricted' : 'failed_download'
                job.updateSong(songId, { status: songStatus, phase: 'download' })
                if (task?.error) {
                  if (isCopyright) {
                    log('warn', `版权受限: ${r.song.name}`, task.error)
                  } else {
                    addFailure(r.song.name, task.error)
                    log('error', `下载失败: ${r.song.name}`, task.error)
                  }
                }
              } else if (task.status === 'done') {
                job.updateSong(songId, {
                  status: 'success', phase: 'done',
                  filePath: task.filePath, fileType: task.fileType,
                  metadata: { trackNumber: r.song.no, quality: cfg.netease.quality, duration: r.song.dt, disc: r.song.disc || '1' },
                })
              }
            }

            const okCount = songsToDownload.filter((r) => {
              const js = job.getJob().songs.find((s) => s.songName === r.song.name && s.sourceId === source.id)
              return js?.status === 'success'
            }).length
            const failCount = songsToDownload.length - okCount
            log('info', `下载完成: ${okCount} 成功, ${failCount} 失败`)
            job.finishStep(s3, failCount > 0 ? 'partial' : 'success', `${okCount} 首成功，${failCount} 首失败`)
          } else if (dryRun && songsToDownload.length > 0) {
            const s3 = job.startStep('download', '下载歌曲')
            for (const r of songsToDownload) {
              log('info', `[预览] 将下载: ${r.song.name}`)
            }
            job.finishStep(s3, 'success', `[预览] 共 ${songsToDownload.length} 首`)
          }

          // Mark copyright-restricted resolutions (skip Plex retry)
          const allTasks = listDownloadTasks({ status: undefined })
          for (const r of resolutions) {
            if (r.resolution === 'needs_download') {
              const task = allTasks.items.find((t) => t.songId === r.song.id && t.jobId === job.getId())
              if (task?.status === 'failed' && (task.error?.includes('无法获取歌曲') || task.error?.includes('下载链接'))) {
                r.resolution = 'copyright_restricted'
              }
            }
          }

          // ── Step 4: Reorder Plex playlist (with retry-based lookup for new tracks) ──
          if (!dryRun && !skipPlexPL) {
            const s4 = job.startStep('reorder', '重排 Plex 歌单')
            setStage('updating_plex_playlist')

            // Trigger Plex scan if needed (fire and forget — we'll retry-search below)
            if (needsRefresh && sectionKey) {
              await triggerRescan(sectionKey)
            }

            log('info', '开始 Plex 查找重试')
            // Build target order: all resolved tracks with plexRatingKeys
            // For needs_download / found_on_disk, retry-search with backoff
            const targetOrder: string[] = []
            for (const r of resolutions) {
              if (r.resolution === 'needs_download') {
                const [albumArtist] = splitArtists(r.song.artists)
                const rk = await findTrackWithRetry(sectionKey, r.song, albumArtist, cfg.sync.plexScanRetries, cfg.sync.plexScanRetryDelaySec * 1000)
                if (rk) {
                  r.plexRatingKey = rk
                  r.resolution = 'found_in_plex_library'
                  log('info', `Plex 已索引: ${r.song.name}`)
                } else {
                  log('warn', `Plex 未找到: ${r.song.name}（请手动扫描 Plex）`)
                  const sid = job.getJob().songs.find((s) => s.songName === r.song.name && s.sourceId === source.id)?.id
                  if (sid) job.updateSong(sid, { status: 'failed_plex_match', phase: 'plex_match' })
                }
              }
              if (r.resolution === 'found_on_disk') {
                const [albumArtist] = splitArtists(r.song.artists)
                const rk = await findTrackWithRetry(sectionKey, r.song, albumArtist, cfg.sync.plexScanRetries, cfg.sync.plexScanRetryDelaySec * 1000)
                if (rk) {
                  r.plexRatingKey = rk
                  r.resolution = 'found_in_plex_library'
                } else {
                  const sid = job.getJob().songs.find((s) => s.songName === r.song.name && s.sourceId === source.id)?.id
                  if (sid) job.updateSong(sid, { status: 'failed_plex_match', phase: 'plex_match' })
                }
              }
              if (r.plexRatingKey) targetOrder.push(r.plexRatingKey)
            }

            // Fetch current playlist items for the LCS
            const currentItems = (await getPlaylistTracks(plexPlaylist.ratingKey, 99999))
              .filter((t) => t.playlistItemID)
              .map((t) => ({ ratingKey: t.ratingKey, playlistItemId: t.playlistItemID! }))

            await applyFullReorder(
              plexPlaylist.ratingKey, targetOrder, currentItems, sectionKey,
              () => cancelRequested,
              (lvl, msg) => log(lvl as 'info' | 'warn' | 'error', msg),
            )

            job.finishStep(s4, 'success', 'Plex 歌单重排完成')
          }

          // ── Finalize source ──
          const succCount = job.getJob().songs.filter((s) => s.status === 'success' && s.sourceId === source.id).length
          const failCount = job.getJob().songs.filter((s) =>
            ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status) && s.sourceId === source.id,
          ).length
          const restrictedCount = job.getJob().songs.filter((s) => s.status === 'copyright_restricted' && s.sourceId === source.id).length
          const ignoredCount = job.getJob().songs.filter((s) => s.status === 'ignored_failure' && s.sourceId === source.id).length

          let sourceStatus: PlaylistSource['lastStatus'] = 'success'
          if (failCount > 0 && succCount > 0) sourceStatus = 'partial'
          else if (failCount > 0 && succCount === 0) sourceStatus = 'failed'

          // Re-fetch plexUpdatedAt after reorder (playlist was modified)
          let finalPlexUpdatedAt = plexUpdatedAt
          if (plexPlaylist?.ratingKey) {
            try {
              const r = await fetch(`http://${cfg.plex.server}:${cfg.plex.port}/playlists/${plexPlaylist.ratingKey}?X-Plex-Token=${cfg.plex.token}`)
              const x = await r.text(); const m2 = x.match(/updatedAt="(\d+)"/)
              if (m2) finalPlexUpdatedAt = parseInt(m2[1]!, 10)
            } catch { /* non-critical */ }
          }

          updateSource(source.id, {
            lastSyncedAt: new Date().toISOString(),
            lastStatus: sourceStatus,
            lastError: failCount > 0 ? `${failCount} 首失败`
              : restrictedCount > 0 || ignoredCount > 0
                ? `${[restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '', ignoredCount > 0 ? `${ignoredCount} 首已忽略` : ''].filter(Boolean).join('，')}`
                : null,
            lastJobId: job.getId(),
            trackCount: yunSongs.length,
            plexPlaylistRatingKey: plexPlaylist?.ratingKey || '',
            lastTrackUpdateTime: trackUpdateTime,
            plexUpdatedAt: finalPlexUpdatedAt,
            consecutiveSkips: 0,
            lastFullCompareAt: new Date().toISOString(),
            trackIdSnapshot: JSON.stringify(currentIdOrder),
          })

          // Update copyright-restricted and failure caches
          const newRestricted = job.getJob().songs
            .filter((s) => s.status === 'copyright_restricted' && s.sourceId === source.id)
            .map((s) => resolutions.find((r) => r.song.name === s.songName)?.song.id)
            .filter(Boolean) as number[]
          if (newRestricted.length > 0) {
            const merged = [...new Set([...knownRestricted, ...newRestricted])]
            updateSource(source.id, { copyrightRestrictedIds: JSON.stringify(merged) })
          }

          // Track failure counts: increment for failed (download/Plex) songs
          const failedSongIds = job.getJob().songs
            .filter((s) =>
              ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status) && s.sourceId === source.id,
            )
            .map((s) => resolutions.find((r) => r.song.name === s.songName)?.song.id)
            .filter(Boolean) as number[]
          // Also track songs marked as needs_download but not found by findTrackWithRetry (resolution still needs_download after reorder)
          const unfoundSongIds = resolutions
            .filter((r) => r.resolution === 'needs_download' && !r.plexRatingKey)
            .map((r) => r.song.id)
          // Track failure counts: always increment, never reset (only clear via button)
          if (failedSongIds.length > 0 || unfoundSongIds.length > 0) {
            const newFailures: Record<number, number> = { ...failureMap }
            for (const sid of [...failedSongIds, ...unfoundSongIds]) {
              newFailures[sid] = (newFailures[sid] || 0) + 1
            }
            updateSource(source.id, { ignoredFailureIds: JSON.stringify(newFailures) })
          }

          totalSuccess += succCount
          totalFailed += failCount

          const parts = [`${succCount} 成功`]
          if (failCount > 0) parts.push(`${failCount} 失败`)
          if (restrictedCount > 0) parts.push(`${restrictedCount} 版权受限`)
          if (ignoredCount > 0) parts.push(`${ignoredCount} 已忽略`)
          log('info', `歌单「${playlistName}」: ${parts.join(', ')}`)
    } catch (err) {
      if (err instanceof CancellationError) throw err

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `歌单「${source.name}」同步失败: ${message}`)
      updateSource(source.id, {
        lastSyncedAt: new Date().toISOString(),
        lastStatus: 'failed',
        lastError: message,
      })
      totalFailed++
    }
  }

  // ── Overall finalize ──
  const jobStatus: 'success' | 'partial' | 'failed' =
    totalFailed === 0 ? 'success' :
    totalSuccess > 0 ? 'partial' : 'failed'

  const finishedJob = job.finish(jobStatus, '')
  const summary = dryRun
    ? `[预览] ${sources.length} 个歌单源`
    : finishedJob.failedSongs > 0 || finishedJob.warnings > 0
      ? `${sources.length} 个源，成功 ${finishedJob.successSongs} 首${finishedJob.failedSongs > 0 ? `，失败 ${finishedJob.failedSongs} 首` : ''}${finishedJob.warnings > 0 ? `，${finishedJob.warnings} 首已忽略` : ''}`
      : `${sources.length} 个源，共同步 ${finishedJob.totalSongs} 首歌曲`
  finishedJob.summary = summary
  saveJob(finishedJob)

  log('info', summary)
  finishState(finishedJob.status === 'success' ? 'success' : 'failure')
  return { ...state }
    } catch (err) {
      if (err instanceof CancellationError) {
        const j = job.finish('cancelled', '用户取消')
        saveJob(j)
        finishState('success')
        return { ...state }
      }

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `同步失败: ${message}`)

      const j = job.finish('failed', message)
      saveJob(j)
      finishState('failure')
      return { ...state }
    } finally {
      state.isRunning = false
    }
  }

  async function runSyncForSource(sourceId: string, options?: { dryRun?: boolean; forceFull?: boolean }): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')
    return runSync({ dryRun: options?.dryRun, sourceIds: [sourceId], forceFull: options?.forceFull })
  }

  function cancelSync(): boolean {
    if (!state.isRunning) return false
    cancelRequested = true
    return true
  }

  function setStage(stage: SyncState['currentStage']) {
    state.currentStage = stage
    emitEvent({
      type: 'stage-change',
      data: { stage, label: STAGE_LABELS[stage] || stage, sourceName: currentSourceName },
      timestamp: new Date().toISOString(),
    })
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

class CancellationError extends Error { constructor() { super('Cancelled') } }




