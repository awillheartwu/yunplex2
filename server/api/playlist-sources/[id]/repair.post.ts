import { join } from 'node:path'
import dayjs from 'dayjs'
import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning, setRepairRunning } from '../../../lib/sync/instance'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { resolveSingleSongConfig } from '../../../lib/download/options'
import { fetchPlaylistSongs, fetchAlbumSongs, setArtistAliases } from '../../../lib/netease'
import { saveSyncRun } from '../../../lib/run/store'
import { appendLog } from '../../../lib/log/store'
import { emitEvent } from '../../../lib/sync/events'
import type { SyncJob } from '../../../lib/job/types'
import { randomUUID } from 'node:crypto'
import { buildDownloadPath } from '../../../lib/tag-writer'
import { createSplitArtists } from '../../../lib/sync/artist-utils'
import { resolveAccessibleLocalPath } from '../../../lib/sync/path-map'
import { findExistingLocalSongPath } from '../../../lib/sync/local-file-discovery'
import { getLocalMediaAsset } from '../../../lib/sync/local-media-store'
import { getSongIdentityBinding } from '../../../lib/sync/identity-store'
import { getSectionKey, initPlexClient, refreshLibrary } from '../../../lib/plex-client'

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
      const limit = source.syncLimit == null || source.syncLimit === 0 ? undefined : source.syncLimit
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
  const dataDir = useRuntimeConfig(event).dataDir
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
      summary: `修复本地标签与辅助文件: ${source.name}`,
      source: '网易云音乐',
      sourceIds: [source.id],
      target: '本地磁盘与 Plex',
      totalSongs,
      successSongs: 0,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun: false,
      steps: [{
        id: 'repair-1', type: 'repair', title: `修复本地标签与辅助文件: ${source.name}`,
        status: 'running', startedAt: now, finishedAt: null, durationMs: 0,
        message: `共 ${totalSongs} 首`, children: [],
      }],
      songs: [],
      config: {},
    }
    saveSyncRun(job, 'user')

    appendLog(dataDir, { level: 'info', message: `[修复] 开始: ${source.name}，共 ${totalSongs} 首`, stage: 'download' }, retentionDays)
    emitEvent({ type: 'stage-change', data: { stage: 'repair', sourceId: id, jobId }, timestamp: now })
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
    let metadataRepaired = 0

    for (const song of songs) {
      try {
        // Two-level path lookup
        let audioPath: string | undefined

        try {
          const songDetail = await import('../../../lib/netease').then((m) => m.fetchSongDetail(song.id, cfg.netease.cookie))
          const splitArtists = createSplitArtists(cfg.other?.multiArtistFormat ?? 'ampersand')
          const [albumArtist] = splitArtists(songDetail.artists)
          const discoveredPath = findExistingLocalSongPath(songDetail, cfg)
          if (discoveredPath) {
            audioPath = discoveredPath
          } else {
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
            const localAsset = getLocalMediaAsset(song.id)
            const binding = getSongIdentityBinding(song.id)
            audioPath = resolveAccessibleLocalPath(localAsset?.filePath, cfg)
              ?? resolveAccessibleLocalPath(computedPath, cfg)
              ?? resolveAccessibleLocalPath(binding?.plexFilePath, cfg)
              ?? undefined
          }
        } catch { /* can't resolve — skip */ }

        if (!audioPath) {
          skipped++
          continue
        }

        const result = await downloadSingleSong(song.id, resolveSingleSongConfig(cfg, {
          embedMetadata: true,
          embedCover: false,
          downloadMode: 'missing',
          audioPath,
        }))
        // Distinguish actual writes from pure skips
        if (result.ops.tags === 'ok') metadataRepaired++
        if (result.ops.tags === 'ok' || result.ops.lyric === 'ok' || result.ops.cover === 'ok') {
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
        appendLog(dataDir, { level: 'info', message: `[修复] ${source.name}: 已处理 ${processed}/${totalSongs} 首，修复标签 ${metadataRepaired}，写入 ${succeeded}，跳过 ${skipped}`, stage: 'download' }, retentionDays)
        emitEvent({
          type: 'repair-progress',
          data: { jobId, sourceId: id, processed, totalSongs, succeeded, skipped, metadataRepaired },
          timestamp: new Date().toISOString(),
        })
      }
    }

    let plexRefreshRequested = false
    if (metadataRepaired > 0) {
      try {
        await initPlexClient(cfg.plex)
        const sectionKey = await getSectionKey(cfg.plex.section)
        if (!sectionKey) throw new Error(`未找到 Plex 音乐库「${cfg.plex.section}」`)
        await refreshLibrary(sectionKey)
        plexRefreshRequested = true
        appendLog(dataDir, { level: 'info', message: `[修复] 已请求 Plex 刷新媒体库，等待识别更新后的标签`, stage: 'refreshing_plex' }, retentionDays)
      } catch (err) {
        job.warnings++
        const detail = err instanceof Error ? err.message : String(err)
        appendLog(dataDir, { level: 'warn', message: `[修复] Plex 刷新请求失败`, detail, stage: 'refreshing_plex' }, retentionDays)
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
    job.summary = `媒体修复完成: ${source.name}，修复标签 ${metadataRepaired}，写入 ${succeeded}，跳过 ${skipped}${plexRefreshRequested ? '，已请求 Plex 刷新' : ''}`
    if (job.steps[0]) {
      job.steps[0].status = 'success'
      job.steps[0].finishedAt = endTime
      job.steps[0].durationMs = job.durationMs
      job.steps[0].message = `修复标签 ${metadataRepaired}，写入 ${succeeded}，跳过 ${skipped}${plexRefreshRequested ? '，已请求 Plex 刷新' : ''}`
    }
    saveSyncRun(job)
    updateSource(source.id, { lastStatus: job.status, lastSyncedAt: endTime })

    appendLog(dataDir, { level: 'info', message: `[修复] 完成: ${source.name}，修复标签 ${metadataRepaired}，写入 ${succeeded}，跳过 ${skipped}${plexRefreshRequested ? '，已请求 Plex 刷新' : ''}`, stage: 'download' }, retentionDays)
    emitEvent({
      type: 'repair-progress',
      data: { jobId, sourceId: id, processed: totalSongs, totalSongs, succeeded, skipped, metadataRepaired, plexRefreshRequested, finished: true },
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
    job.summary = `媒体修复异常中断: ${source.name}`
    saveSyncRun(job)
    updateSource(source.id, { lastStatus: 'failed', lastError: msg })
    setRepairRunning(false)
    appendLog(dataDir, { level: 'error', message: `[修复] 异常中断: ${source.name}`, detail: msg, stage: 'download' }, retentionDays)
    emitEvent({ type: 'stage-change', data: { stage: 'idle', sourceId: id }, timestamp: new Date().toISOString() })
  })

  return success({ triggered: true, sourceId: id, jobId, totalSongs }, `补全辅助数据已触发，共 ${totalSongs} 首`)
})
