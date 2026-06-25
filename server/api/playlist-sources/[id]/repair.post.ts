import { join } from 'node:path'
import dayjs from 'dayjs'
import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning, setRepairRunning } from '../../../lib/sync/instance'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { fetchPlaylistSongs, fetchAlbumSongs, setArtistAliases } from '../../../lib/netease'
import { getDb } from '../../../lib/db'
import { saveSyncRun } from '../../../lib/run/store'
import { appendLog } from '../../../lib/log/store'
import { emitEvent } from '../../../lib/sync/events'
import { recordActivityEvent } from '../../../lib/activity/store'
import type { SyncJob } from '../../../lib/job/types'
import { randomUUID } from 'node:crypto'
import { buildDownloadPath } from '../../../lib/tag-writer'
import { createSplitArtists } from '../../../lib/sync/artist-utils'
import { resolveAccessibleLocalPath } from '../../../lib/sync/path-map'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')
  if (isRepairRunning()) return fail('已有补全任务在运行中，请等待完成')

  // Fetch all song IDs
  const cfg = readConfig()
  setArtistAliases(cfg.other?.artistAliases ?? {}, cfg.other?.applyAliasToAlbum ?? false)
  let songs: Array<{ id: number; name: string }>
  try {
    if (source.type === 'album') {
      const albumSongs = await fetchAlbumSongs(source.neteasePlaylistId, cfg.netease.cookie)
      songs = albumSongs.map((s) => ({ id: s.id, name: s.name }))
    } else {
      const limit = source.syncLimit === 0 ? undefined : source.syncLimit
      const result = await fetchPlaylistSongs(source.neteasePlaylistId, limit, cfg.netease.cookie)
      songs = result.songs.map((s) => ({ id: s.id, name: s.name }))
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取歌曲列表失败')
  }

  // Acquire mutex only after all pre-flight checks pass
  setRepairRunning(true)

  const totalSongs = songs.length
  const jobId = randomUUID().slice(0, 12)
  const now = new Date().toISOString()
  const dataDir = (useRuntimeConfig() as any).dataDir as string
  const retentionDays = cfg.sync.logRetentionDays ?? 30

  // Create repair job (wrapped in try — release lock if this fails)
  let job: SyncJob
  try {
    job = {
      id: jobId,
      type: 'repair',
      startedAt: now,
      finishedAt: null,
      status: 'running',
      durationMs: 0,
      summary: `补全辅助文件: ${source.name}`,
      source: '网易云音乐',
      sourceIds: [source.id],
      target: '本地磁盘',
      totalSongs,
      successSongs: 0,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [{
        id: 'repair-1', type: 'repair', title: `补全辅助文件: ${source.name}`,
        status: 'running', startedAt: now, finishedAt: null, durationMs: 0,
        message: `共 ${totalSongs} 首`, children: [],
      }],
      songs: [],
      config: {},
    }
    saveSyncRun(job, 'user')

    appendLog(dataDir, { level: 'info', message: `[补全] 开始: ${source.name}，共 ${totalSongs} 首`, stage: 'download' }, retentionDays)
    emitEvent({ type: 'stage-change', data: { stage: 'repair', sourceId: id, jobId }, timestamp: now })
    recordActivityEvent({
      domain: 'user',
      type: 'repair_triggered',
      severity: 'info',
      actor: 'user',
      title: `触发“${source.neteasePlaylistName || source.name}”补全`,
      summary: `将为 ${totalSongs} 首歌曲补齐歌词、封面或其他辅助文件。`,
      context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, jobId, totalSongs },
      link: `/task-center/runs/${jobId}`,
      groupKey: `job:${jobId}`,
    })
  } catch (err) {
    setRepairRunning(false)
    return fail(err instanceof Error ? err.message : '创建补全任务失败')
  }

  // Fire-and-forget
  ;(async () => {
    let processed = 0
    let succeeded = 0
    let alreadyExisted = 0
    let skipped = 0

    for (const song of songs) {
      try {
        // Two-level path lookup
        let audioPath: string | undefined

        try {
          const songDetail = await import('../../../lib/netease').then((m) => m.fetchSongDetail(song.id, cfg.netease.cookie))
          const splitArtists = createSplitArtists(cfg.other?.multiArtistFormat ?? 'ampersand')
          const [albumArtist] = splitArtists(songDetail.artists)
          const pathVars = {
            artist: albumArtist,
            album: songDetail.album.name,
            title: songDetail.name,
            year: songDetail.album.publishTime > 0 ? dayjs(songDetail.album.publishTime).format('YYYY') : '',
            track: String(songDetail.no),
            'track:02d': String(songDetail.no).padStart(2, '0'),
          }
          const computedPath = join(cfg.download.dir, buildDownloadPath(
            cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
            pathVars, 'mp3',
          ))

          const resolvedComputedPath = resolveAccessibleLocalPath(computedPath, cfg)
          if (resolvedComputedPath) {
            audioPath = resolvedComputedPath
          } else {
            // Fallback: song_lookup cache
            const db = getDb()
            const cached = db.prepare('SELECT file_path FROM song_lookup WHERE netease_song_id = ?').get(song.id) as { file_path: string | null } | undefined
            const resolvedCachedPath = resolveAccessibleLocalPath(cached?.file_path, cfg)
            if (resolvedCachedPath) {
              audioPath = resolvedCachedPath
            }
          }
        } catch { /* can't resolve — skip */ }

        if (!audioPath) {
          skipped++
          continue
        }

        const result = await downloadSingleSong(song.id, {
          quality: cfg.netease.quality,
          cookie: cfg.netease.cookie,
          downloadDir: cfg.download.dir,
          pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
          multiArtistFormat: cfg.other?.multiArtistFormat ?? 'ampersand',
          downloadLyrics: cfg.download.downloadLyrics,
          embedMetadata: false,
          embedCover: false,
          saveAlbumCover: cfg.download.saveAlbumCover ?? false,
          saveArtistImage: cfg.download.saveArtistImage ?? false,
          lyricOrder: (cfg.other?.lyricOrder ?? 'original_first') as 'original_first' | 'translated_first',
          downloadTranslatedLyric: cfg.other?.downloadTranslatedLyric ?? true,
          downloadRomajiLyric: cfg.other?.downloadRomajiLyric ?? false,
          downloadMode: 'missing',
          audioPath,
        })
        // Distinguish actual writes from pure skips
        if (result.ops.lyric === 'ok' || result.ops.cover === 'ok') {
          succeeded++
        } else {
          alreadyExisted++
        }
      } catch {
        skipped++
      }

      processed++
      if (processed % 50 === 0) {
        job.successSongs = succeeded
        job.skippedSongs = skipped + alreadyExisted
        saveSyncRun(job)
        appendLog(dataDir, { level: 'info', message: `[补全] ${source.name}: 已处理 ${processed}/${totalSongs} 首，写入 ${succeeded}，已存在 ${alreadyExisted}，跳过 ${skipped}`, stage: 'download' }, retentionDays)
        emitEvent({
          type: 'repair-progress',
          data: { jobId, sourceId: id, processed, totalSongs, succeeded, skipped },
          timestamp: new Date().toISOString(),
        })
      }
    }

    // Finalize
    const endTime = new Date().toISOString()
    job.finishedAt = endTime
    job.status = succeeded + alreadyExisted + skipped === totalSongs ? 'success' : 'partial'
    job.successSongs = succeeded
    job.skippedSongs = skipped + alreadyExisted
    job.failedSongs = 0
    job.durationMs = Date.now() - new Date(now).getTime()
    job.summary = `补全完成: ${source.name}，写入 ${succeeded}，已存在 ${alreadyExisted}，跳过 ${skipped}`
    if (job.steps[0]) {
      job.steps[0].status = 'success'
      job.steps[0].finishedAt = endTime
      job.steps[0].durationMs = job.durationMs
      job.steps[0].message = `写入 ${succeeded}，已存在 ${alreadyExisted}，跳过 ${skipped}`
    }
    saveSyncRun(job)
    updateSource(source.id, { lastStatus: job.status, lastSyncedAt: endTime })

    appendLog(dataDir, { level: 'info', message: `[补全] 完成: ${source.name}，写入 ${succeeded}，已存在 ${alreadyExisted}，跳过 ${skipped}`, stage: 'download' }, retentionDays)
    recordActivityEvent({
      domain: 'sync',
      type: 'repair_completed',
      severity: job.status === 'success' ? 'success' : 'warning',
      title: `补全“${source.neteasePlaylistName || source.name}”已完成`,
      summary: `写入 ${succeeded}，已存在 ${alreadyExisted}，跳过 ${skipped}`,
      context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, jobId, succeeded, alreadyExisted, skipped },
      link: `/task-center/runs/${jobId}`,
      groupKey: `job:${jobId}`,
    })
    emitEvent({
      type: 'repair-progress',
      data: { jobId, sourceId: id, processed: totalSongs, totalSongs, succeeded, skipped, finished: true },
      timestamp: endTime,
    })
    setRepairRunning(false)
    emitEvent({ type: 'stage-change', data: { stage: 'idle', sourceId: id }, timestamp: endTime })
  })().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] repair failed:', msg)
    job.status = 'failed'
    job.finishedAt = new Date().toISOString()
    job.durationMs = Date.now() - new Date(now).getTime()
    job.summary = `补全异常中断: ${source.name}`
    saveSyncRun(job)
    updateSource(source.id, { lastStatus: 'failed', lastError: msg })
    setRepairRunning(false)
    appendLog(dataDir, { level: 'error', message: `[补全] 异常中断: ${source.name}`, detail: msg, stage: 'download' }, retentionDays)
    recordActivityEvent({
      domain: 'sync',
      type: 'repair_failed',
      severity: 'error',
      title: `补全“${source.neteasePlaylistName || source.name}”异常中断`,
      summary: msg,
      context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, jobId },
      link: `/task-center/runs/${jobId}`,
      groupKey: `job:${jobId}`,
    })
    emitEvent({ type: 'stage-change', data: { stage: 'idle', sourceId: id }, timestamp: new Date().toISOString() })
  })

  return success({ triggered: true, sourceId: id, jobId, totalSongs }, `补全辅助数据已触发，共 ${totalSongs} 首`)
})
