import { success, fail } from '../../../lib/response'
import type { SongStatus } from '../../../lib/job/types'
import { getSyncRun } from '../../../lib/run/store'
import { getSource } from '../../../lib/playlist/store'
import { startManagedSongDownload } from '../../../lib/download/managed-media-command'
import { emitEvent } from '../../../lib/sync/events'

const RETRYABLE_STATUSES = new Set<SongStatus>([
  'failed_download',
  'failed_tags',
  'failed_plex_match',
  'failed_plex_insert',
])

/**
 * Historical sync runs remain immutable. Retrying one song creates a new
 * source-aware manual download run for the persistent worker. A successful
 * managed write marks the source for realignment, while Source Convergence
 * remains the only code allowed to mutate Plex playlists.
 */
export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'id')
  if (!runId) return fail('缺少运行 ID')

  const body = await readBody<{ songId: string }>(event)
  const { songId } = body || {}
  if (!songId) return fail('缺少歌曲 ID')

  const run = getSyncRun(runId)
  if (!run) return fail('运行记录不存在')

  const song = run.songs.find(candidate => candidate.id === songId)
  if (!song) return fail('歌曲不存在')
  if (!RETRYABLE_STATUSES.has(song.status)) return fail('只有失败歌曲可以重试')
  if (!song.neteaseSongId) return fail('此歌曲缺少网易云歌曲 ID，无法直接重试')
  if (!song.sourceId) return fail('该歌曲缺少歌单源信息')
  if (!getSource(song.sourceId)) return fail('歌单源不存在')

  try {
    const result = await startManagedSongDownload({
      sourceId: song.sourceId,
      neteaseSongId: song.neteaseSongId,
    })
    emitEvent({
      type: 'song-retry-progress',
      data: {
        jobId: runId,
        runId,
        songId,
        status: 'queued',
        downloadRunId: result.batchId,
      },
      timestamp: new Date().toISOString(),
    })
    return success({
      triggered: true,
      runId,
      songId,
      downloadRunId: result.batchId,
    }, '已创建带来源归属的重试下载任务')
  } catch (error) {
    return fail(error instanceof Error ? error.message : '重试下载入队失败')
  }
})
