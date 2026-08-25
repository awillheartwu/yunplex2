import { success, fail } from '../../../lib/response'
import type { SongStatus } from '../../../lib/job/types'
import { getSyncRun, saveSyncRun } from '../../../lib/run/store'
import { getSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { resolveSingleSongConfig } from '../../../lib/download/options'
import { emitEvent } from '../../../lib/sync/events'
import { appendLog } from '../../../lib/log/store'
import { setArtistAliases } from '../../../lib/netease'
import { classifyDownloadFailure } from '../../../lib/sync/download-diagnostics'
import { isTagWriteError } from '../../../lib/tag-writer'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'

const RETRYABLE_STATUSES = new Set<SongStatus>([
  'failed_download',
  'failed_tags',
  'failed_plex_match',
  'failed_plex_insert',
])

function applyRetryOutcome(
  run: NonNullable<ReturnType<typeof getSyncRun>>,
  previousStatus: SongStatus,
  nextStatus: SongStatus,
): void {
  if (RETRYABLE_STATUSES.has(previousStatus) && !RETRYABLE_STATUSES.has(nextStatus)) {
    run.failedSongs = Math.max(0, run.failedSongs - 1)
  }
  if (!RETRYABLE_STATUSES.has(previousStatus) && RETRYABLE_STATUSES.has(nextStatus)) {
    run.failedSongs += 1
  }
  if (previousStatus === 'success' && nextStatus !== 'success') {
    run.successSongs = Math.max(0, run.successSongs - 1)
  }
  if (previousStatus !== 'success' && nextStatus === 'success') {
    run.successSongs += 1
  }
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
  if (!RETRYABLE_STATUSES.has(song.status)) return fail('只有失败歌曲可以重试')

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
  const previousStatus = song.status
  song.status = 'downloading'
  song.phase = 'download'
  delete song.error
  saveSyncRun(run)

  setArtistAliases(cfg.other?.artistAliases ?? {}, cfg.other?.applyAliasToAlbum ?? false)
  appendLog(dataDir, { level: 'info', message: `[重试] 开始下载: ${song.songName} - ${song.artist}`, stage: 'download' }, retentionDays)

  downloadSingleSong(neteaseId, resolveSingleSongConfig(cfg, {
    downloadMode: 'full',
  }), (pct) => {
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
      applyRetryOutcome(currentRun, previousStatus, currentSong.status)
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
    applyRetryOutcome(currentRun, previousStatus, currentSong.status)
    saveSyncRun(currentRun)
    appendLog(dataDir, { level: 'info', message: `[重试] 下载成功: ${song.songName} - ${song.artist} → ${result.filePath}`, stage: 'download' }, retentionDays)
    let syncRunId: string | undefined
    if (!syncService.getState().isRunning && !isRepairRunning()) {
      syncRunId = syncService.startSyncForSource(source.id, { mode: 'full', trigger: 'retry' }).runId
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

    const currentRun = getSyncRun(runId)
    const currentSong = currentRun?.songs.find((candidate) => candidate.id === songId)
    if (currentRun && currentSong) {
      currentSong.status = diagnosis.status
      currentSong.phase = diagnosis.phase
      if (tagError?.filePath) currentSong.filePath = tagError.filePath
      if (tagError?.fileType) currentSong.fileType = tagError.fileType
      if (tagError?.ops) currentSong.ops = tagError.ops
      currentSong.error = { title: diagnosis.title, message: msg, stage: diagnosis.phase, songName: song.songName, artist: song.artist }
      applyRetryOutcome(currentRun, previousStatus, currentSong.status)
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
