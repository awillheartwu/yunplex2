import { success, fail } from '../../../lib/response'
import { getJob, saveJob } from '../../../lib/job/store'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { emitEvent } from '../../../lib/sync/events'
import { appendLog } from '../../../lib/log/store'

export default defineEventHandler(async (event) => {
  const jobId = getRouterParam(event, 'id')
  if (!jobId) return fail('缺少任务 ID')

  const body = await readBody<{ songId: string }>(event)
  const { songId } = body || {}
  if (!songId) return fail('缺少歌曲 ID')

  // Load job and find song
  const job = getJob(jobId)
  if (!job) return fail('任务不存在')

  const song = job.songs.find((s) => s.id === songId)
  if (!song) return fail('歌曲不存在')

  if (!song.neteaseSongId) return fail('此歌曲缺少网易云歌曲 ID，无法重试（旧版任务记录）')

  if (song.status === 'downloading') return fail('该歌曲正在下载中')

  if (!song.sourceId) return fail('该歌曲缺少歌单源信息')

  // Load source
  const source = getSource(song.sourceId)
  if (!source) return fail('歌单源不存在')

  // Clear failure caches for this song
  const neteaseId = song.neteaseSongId
  let restrictedIds: number[] = source.copyrightRestrictedIds
    ? JSON.parse(source.copyrightRestrictedIds)
    : []
  const failureMap: Record<number, number> = source.ignoredFailureIds
    ? JSON.parse(source.ignoredFailureIds)
    : {}

  restrictedIds = restrictedIds.filter((id) => id !== neteaseId)
  delete failureMap[neteaseId]

  updateSource(source.id, {
    copyrightRestrictedIds: restrictedIds.length > 0 ? JSON.stringify(restrictedIds) : null,
    ignoredFailureIds: Object.keys(failureMap).length > 0 ? JSON.stringify(failureMap) : null,
  })

  // Update song status to downloading
  song.status = 'downloading'
  song.phase = 'download'
  delete song.error
  saveJob(job)

  // Fire-and-forget download
  const cfg = readConfig()
  const dataDir = (useRuntimeConfig() as any).dataDir as string
  const retentionDays = cfg.sync.logRetentionDays ?? 30
  appendLog(dataDir, { level: 'info', message: `[重试] 开始下载: ${song.songName} - ${song.artist}`, stage: 'download' }, retentionDays)

  downloadSingleSong(neteaseId, {
    quality: cfg.netease.quality,
    cookie: cfg.netease.cookie,
    downloadDir: cfg.download.dir,
    pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
    multiArtistFormat: cfg.other?.multiArtistFormat ?? 'ampersand',
    downloadLyrics: cfg.download.downloadLyrics,
    embedMetadata: cfg.download.embedMetadata,
    embedCover: cfg.download.embedCover,
    saveAlbumCover: cfg.download.saveAlbumCover ?? false,
    saveArtistImage: cfg.download.saveArtistImage ?? false,
    lyricOrder: (cfg.other?.lyricOrder ?? 'original_first') as 'original_first' | 'translated_first',
    downloadTranslatedLyric: cfg.other?.downloadTranslatedLyric ?? true,
    downloadRomajiLyric: cfg.other?.downloadRomajiLyric ?? false,
    downloadMode: 'full',
  }, (pct) => {
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId, songId, status: 'downloading', progress: pct },
      timestamp: new Date().toISOString(),
    })
  }).then((result) => {
    // Reload job (may have been modified) and update song
    const currentJob = getJob(jobId)
    if (currentJob) {
      const s = currentJob.songs.find((x) => x.id === songId)
      if (s) {
        s.status = 'success'
        s.phase = 'done'
        s.filePath = result.filePath
        s.fileType = result.fileType
        s.ops = result.ops
        delete s.error
        // Recalculate stats
        currentJob.successSongs = currentJob.songs.filter((x) => x.status === 'success').length
        currentJob.failedSongs = currentJob.songs.filter((x) =>
          ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(x.status),
        ).length
        currentJob.skippedSongs = currentJob.songs.filter((x) => x.status === 'skipped_existing').length
        currentJob.warnings = currentJob.songs.filter((x) =>
          ['copyright_restricted', 'ignored_failure'].includes(x.status),
        ).length
        saveJob(currentJob)
      }
    }
    appendLog(dataDir, { level: 'info', message: `[重试] 下载成功: ${song.songName} - ${song.artist} → ${result.filePath}`, stage: 'download' }, retentionDays)
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId, songId, status: 'success', filePath: result.filePath, fileType: result.fileType, ops: result.ops },
      timestamp: new Date().toISOString(),
    })
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : '下载失败'
    const stage = 'download'
    const isCopyright = msg.includes('无法获取歌曲') || msg.includes('下载链接')
    appendLog(dataDir, { level: 'error', message: `[重试] 下载失败: ${song.songName} - ${song.artist}`, detail: msg, stage }, retentionDays)

    // Re-populate failure cache so next sync doesn't waste an attempt
    const currentSource = getSource(song.sourceId!)
    if (currentSource) {
      const restricted: number[] = currentSource.copyrightRestrictedIds
        ? JSON.parse(currentSource.copyrightRestrictedIds)
        : []
      const failureMap: Record<number, number> = currentSource.ignoredFailureIds
        ? JSON.parse(currentSource.ignoredFailureIds)
        : {}

      if (isCopyright) {
        if (!restricted.includes(neteaseId)) restricted.push(neteaseId)
        updateSource(currentSource.id, { copyrightRestrictedIds: JSON.stringify(restricted) })
      } else {
        failureMap[neteaseId] = (failureMap[neteaseId] || 0) + 1
        updateSource(currentSource.id, { ignoredFailureIds: JSON.stringify(failureMap) })
      }
    }

    // Update song status to failed
    const currentJob = getJob(jobId)
    if (currentJob) {
      const s = currentJob.songs.find((x) => x.id === songId)
      if (s) {
        s.status = isCopyright ? 'copyright_restricted' : 'failed_download'
        s.phase = stage
        s.error = { title: '重试失败', message: msg, stage, songName: song.songName, artist: song.artist }
        // Recalculate stats
        currentJob.failedSongs = currentJob.songs.filter((x) =>
          ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(x.status),
        ).length
        currentJob.successSongs = currentJob.songs.filter((x) => x.status === 'success').length
        currentJob.warnings = currentJob.songs.filter((x) =>
          ['copyright_restricted', 'ignored_failure'].includes(x.status),
        ).length
        saveJob(currentJob)
      }
    }
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId, songId, status: 'failed', error: { message: msg } },
      timestamp: new Date().toISOString(),
    })
  })

  return success({ triggered: true, jobId, songId }, '歌曲重试已触发')
})
