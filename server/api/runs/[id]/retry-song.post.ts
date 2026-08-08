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
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { parsePersistedIntegerIds, serializePersistedIntegerIds } from '~~/lib/persisted-integer-ids'

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
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  const neteaseId = song.neteaseSongId
  const cfg = readConfig()
  const dataDir = useRuntimeConfig(event).dataDir
  const retentionDays = cfg.sync.logRetentionDays ?? 30
  const parsedRestricted = parsePersistedIntegerIds(source.copyrightRestrictedIds)
  let restrictedIds = parsedRestricted.ids
  if (parsedRestricted.issues.length > 0) {
    appendLog(dataDir, {
      level: 'warn',
      message: `[重试] ${source.name} 的版权受限缓存包含损坏数据，已自动修复`,
      detail: `copyrightRestrictedIds: ${parsedRestricted.issues.join(', ')}`,
      stage: 'download',
    }, retentionDays)
  }
  const failureMemory = parseFailureMemory(source.ignoredFailureIds)

  restrictedIds = restrictedIds.filter((id) => id !== neteaseId)
  const nextFailureMemory = removeFailures(failureMemory, [neteaseId])

  updateSource(source.id, {
    copyrightRestrictedIds: serializePersistedIntegerIds(restrictedIds),
    ignoredFailureIds: serializeFailureMemory(nextFailureMemory),
  })

  song.status = 'downloading'
  song.phase = 'download'
  delete song.error
  saveSyncRun(run)

  setArtistAliases(cfg.other?.artistAliases ?? {}, cfg.other?.applyAliasToAlbum ?? false)
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
    let syncRunId: string | undefined
    if (!syncService.getState().isRunning && !isRepairRunning()) {
      syncRunId = syncService.startSyncForSource(source.id, { forceFull: true, trigger: 'retry' }).runId
    }
    emitEvent({
      type: 'song-retry-progress',
      data: { jobId: runId, runId, songId, status: 'success', filePath: result.filePath, fileType: result.fileType, ops: result.ops, syncRunId },
      timestamp: new Date().toISOString(),
    })
  }).catch((err: unknown) => {
    const tagError = isTagWriteError(err) ? err : null
    const msg = tagError ? tagError.message : err instanceof Error ? err.message : '下载失败'
    const diagnosis = classifyDownloadFailure(msg, tagError?.filePath)
    appendLog(dataDir, { level: 'error', message: `[重试] 下载失败: ${song.songName} - ${song.artist}`, detail: msg, stage: diagnosis.phase }, retentionDays)

    const currentSource = getSource(song.sourceId!)
    if (currentSource) {
      const currentRestricted = parsePersistedIntegerIds(currentSource.copyrightRestrictedIds)
      const restricted = currentRestricted.ids
      const memory = parseFailureMemory(currentSource.ignoredFailureIds)

      if (currentRestricted.issues.length > 0) {
        appendLog(dataDir, {
          level: 'warn',
          message: `[重试] ${currentSource.name} 的版权受限缓存包含损坏数据，已自动修复`,
          detail: `copyrightRestrictedIds: ${currentRestricted.issues.join(', ')}`,
          stage: diagnosis.phase,
        }, retentionDays)
        updateSource(currentSource.id, {
          copyrightRestrictedIds: serializePersistedIntegerIds(restricted),
        })
      }

      if (diagnosis.status === 'copyright_restricted') {
        if (!restricted.includes(neteaseId)) restricted.push(neteaseId)
        updateSource(currentSource.id, { copyrightRestrictedIds: serializePersistedIntegerIds(restricted) })
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
