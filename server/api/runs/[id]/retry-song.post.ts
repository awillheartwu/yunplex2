import { success, fail } from '../../../lib/response'
import { getSyncRun, saveSyncRun } from '../../../lib/run/store'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { emitEvent } from '../../../lib/sync/events'
import { appendLog } from '../../../lib/log/store'
import { setArtistAliases } from '../../../lib/netease'
import {
  parseFailureMemory,
  recordFailure,
  removeFailures,
  serializeFailureMemory,
} from '../../../lib/sync/failure-memory'
import { classifyDownloadFailure } from '../../../lib/sync/download-diagnostics'
import { isTagWriteError } from '../../../lib/tag-writer'
import { getSyncServiceInstance } from '../../../lib/sync/instance'

function refreshRunStats(run: NonNullable<ReturnType<typeof getSyncRun>>): void {
  run.failedSongs = run.songs.filter((song) =>
    ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(song.status),
  ).length
  run.successSongs = run.songs.filter((song) => song.status === 'success').length
  run.skippedSongs = run.songs.filter((song) => song.status === 'skipped_existing').length
  run.warnings = run.songs.filter((song) =>
    ['copyright_restricted', 'ignored_failure'].includes(song.status),
  ).length
}

export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'id')
  if (!runId) return fail('缺少运行 ID')

  const body = await readBody<{ songId: string }>(event)
  const { songId } = body || {}
  if (!songId) return fail('缺少歌曲 ID')

  const run = getSyncRun(runId)
  if (!run) return fail('运行记录不存在')

  const song = run.songs.find((candidate) => candidate.id === songId)
  if (!song) return fail('歌曲不存在')

  if (!song.neteaseSongId) return fail('此歌曲缺少网易云歌曲 ID，无法直接重试')
  if (song.status === 'downloading') return fail('该歌曲正在下载中')
  if (!song.sourceId) return fail('该歌曲缺少歌单源信息')

  const source = getSource(song.sourceId)
  if (!source) return fail('歌单源不存在')
  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  const neteaseId = song.neteaseSongId
  let restrictedIds: number[] = source.copyrightRestrictedIds
    ? JSON.parse(source.copyrightRestrictedIds)
    : []
  const failureMemory = parseFailureMemory(source.ignoredFailureIds)

  restrictedIds = restrictedIds.filter((id) => id !== neteaseId)
  const nextFailureMemory = removeFailures(failureMemory, [neteaseId])

  updateSource(source.id, {
    copyrightRestrictedIds: restrictedIds.length > 0 ? JSON.stringify(restrictedIds) : null,
    ignoredFailureIds: serializeFailureMemory(nextFailureMemory),
  })

  song.status = 'downloading'
  song.phase = 'download'
  delete song.error
  saveSyncRun(run)

  const cfg = readConfig()
  setArtistAliases(cfg.other?.artistAliases ?? {}, cfg.other?.applyAliasToAlbum ?? false)
  const dataDir = useRuntimeConfig(event).dataDir
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
      data: { jobId: runId, runId, songId, status: 'downloading', progress: pct },
      timestamp: new Date().toISOString(),
    })
  }).then((result) => {
    const currentRun = getSyncRun(runId)
    const currentSong = currentRun?.songs.find((candidate) => candidate.id === songId)
    if (!currentRun || !currentSong) return

    if (result.ops?.tags === 'failed') {
      currentSong.status = 'failed_tags'
      currentSong.phase = 'tags'
      currentSong.filePath = result.filePath
      currentSong.fileType = result.fileType
      currentSong.ops = result.ops
      currentSong.error = {
        title: '标签写入失败',
        message: `标签写入失败: ${song.songName}`,
        stage: 'tags',
        songName: song.songName,
        artist: song.artist,
      }
      refreshRunStats(currentRun)
      saveSyncRun(currentRun)
      appendLog(dataDir, { level: 'error', message: `[重试] 标签写入失败: ${song.songName} - ${song.artist}`, stage: 'tags' }, retentionDays)
      emitEvent({
        type: 'song-retry-progress',
        data: { jobId: runId, runId, songId, status: 'failed', filePath: result.filePath, fileType: result.fileType, ops: result.ops, error: { message: '标签写入失败' } },
        timestamp: new Date().toISOString(),
      })
      return
    }

    currentSong.status = 'success'
    currentSong.phase = 'done'
    currentSong.filePath = result.filePath
    currentSong.fileType = result.fileType
    currentSong.ops = result.ops
    delete currentSong.error
    refreshRunStats(currentRun)
    saveSyncRun(currentRun)
    appendLog(dataDir, { level: 'info', message: `[重试] 下载成功: ${song.songName} - ${song.artist} → ${result.filePath}`, stage: 'download' }, retentionDays)
    if (!syncService.getState().isRunning) {
      syncService.runSyncForSource(source.id, { forceFull: true, trigger: 'retry' }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        appendLog(dataDir, { level: 'error', message: `[重试] Plex 补同步触发失败: ${song.songName} - ${song.artist}`, detail: msg, stage: 'plex_match' }, retentionDays)
      })
    }
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId: runId, runId, songId, status: 'success', filePath: result.filePath, fileType: result.fileType, ops: result.ops },
      timestamp: new Date().toISOString(),
    })
  }).catch((err: unknown) => {
    const tagError = isTagWriteError(err) ? err : null
    const msg = tagError ? tagError.message : err instanceof Error ? err.message : '下载失败'
    const diagnosis = classifyDownloadFailure(msg, tagError?.filePath)
    appendLog(dataDir, { level: 'error', message: `[重试] 下载失败: ${song.songName} - ${song.artist}`, detail: msg, stage: diagnosis.phase }, retentionDays)

    const currentSource = getSource(song.sourceId!)
    if (currentSource) {
      const restricted: number[] = currentSource.copyrightRestrictedIds
        ? JSON.parse(currentSource.copyrightRestrictedIds)
        : []
      const memory = parseFailureMemory(currentSource.ignoredFailureIds)

      if (diagnosis.status === 'copyright_restricted') {
        if (!restricted.includes(neteaseId)) restricted.push(neteaseId)
        updateSource(currentSource.id, { copyrightRestrictedIds: JSON.stringify(restricted) })
      } else {
        updateSource(currentSource.id, {
          ignoredFailureIds: serializeFailureMemory(recordFailure(memory, neteaseId, {
            status: diagnosis.status === 'failed_tags' ? 'failed_tags' : 'failed_download',
            phase: diagnosis.phase,
            message: msg,
            suspectedCause: 'unknown',
          })),
        })
      }
    }

    const currentRun = getSyncRun(runId)
    const currentSong = currentRun?.songs.find((candidate) => candidate.id === songId)
    if (currentRun && currentSong) {
      currentSong.status = diagnosis.status
      currentSong.phase = diagnosis.phase
      if (tagError?.filePath) currentSong.filePath = tagError.filePath
      if (tagError?.fileType) currentSong.fileType = tagError.fileType
      if (tagError?.ops) currentSong.ops = tagError.ops
      currentSong.error = { title: diagnosis.title, message: msg, stage: diagnosis.phase, songName: song.songName, artist: song.artist }
      refreshRunStats(currentRun)
      saveSyncRun(currentRun)
    }
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId: runId, runId, songId, status: 'failed', error: { message: msg } },
      timestamp: new Date().toISOString(),
    })
  })

  return success({ triggered: true, runId, songId }, '歌曲重试已触发')
})
