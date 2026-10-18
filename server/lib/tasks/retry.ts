import { getDb, readConfigFromDb } from '../db'
import { getSource } from '../playlist/store'
import { assertSourcesReadyForConvergence } from '../source-initialization/gate'
import { requestSources } from '../sync/source-requests'
import { getSyncWorker } from '../sync/instance'
import { getDownloadTask, requeueFailedDownloadTasks } from '../download/queue'
import { requestDownloadProcessing } from '../download/worker'
import { appendLog } from '../log/store'
import { getFailureRecords, incrementFailureRetries, setFailureRecordStatus } from './failure-records'

export interface RetryTarget {
  sourceId?: string | null
  songId?: number | null
  downloadTaskIds?: readonly string[]
}

/** Explicit retries reopen only the selected targets and start a fresh attempt budget. */
export function retryTargets(targets: readonly RetryTarget[]) {
  const result = getDb().transaction(() => {
    const sourceSongs = new Map<string, Set<number>>()
    const sourceFailures = new Set<string>()
    const fileTaskIds = new Set<string>()
    for (const target of targets) {
      if (target.sourceId && !target.songId) {
        sourceFailures.add(target.sourceId)
        if (!sourceSongs.has(target.sourceId)) sourceSongs.set(target.sourceId, new Set())
        continue
      }
      if (target.sourceId && target.songId) {
        const membership = getDb()
          .prepare(
            `SELECT membership_status FROM playlist_source_track_occurrences
          WHERE source_id = ? AND netease_song_id = ? ORDER BY membership_status = 'current' DESC LIMIT 1`,
          )
          .get(target.sourceId, target.songId) as { membership_status: string } | undefined
        if (membership) {
          if (membership.membership_status !== 'current') continue
          const songs = sourceSongs.get(target.sourceId) ?? new Set<number>()
          songs.add(target.songId)
          sourceSongs.set(target.sourceId, songs)
          continue
        }
      }
      // A saved manual download can have source attribution before first sync.
      for (const id of target.downloadTaskIds ?? []) {
        if (getDownloadTask(id)?.status === 'failed') fileTaskIds.add(id)
      }
    }

    const sources = [...sourceSongs.keys()].map((id) => {
      const source = getSource(id)
      if (!source) throw new Error('来源已不存在，请刷新后重试')
      return source
    })
    assertSourcesReadyForConvergence(sources, readConfigFromDb())
    const sourceRequests = sources.length
      ? requestSources({
          sourceIds: sources.map((source) => source.id),
          trigger: 'retry',
          mode: 'full',
          retrySongIdsBySource: Object.fromEntries([...sourceSongs].map(([id, songs]) => [id, [...songs]])),
        })
      : null
    if (sourceRequests && !sourceRequests.triggered) {
      throw new Error(sourceRequests.results[0]?.message ?? '来源任务未能排队，请稍后重试')
    }
    const requeued = requeueFailedDownloadTasks([...fileTaskIds])
    const failureIds = new Set<string>()
    for (const [sourceId, songIds] of sourceSongs) {
      const ids = [...songIds]
      // Source-level errors are prerequisites for retrying any selected song in that source.
      const scope = ['song_id IS NULL',
        ids.length ? `song_id IN (${ids.map(() => '?').join(',')})` : '0 = 1'].join(' OR ')
      const rows = getDb()
        .prepare(
          `SELECT id FROM failure_records WHERE source_id = ?
        AND (${scope}) AND status IN ('open','ignored')`,
        )
        .all(sourceId, ...ids) as { id: string }[]
      for (const row of rows) failureIds.add(row.id)
    }
    for (const task of requeued) {
      const rows = getDb()
        .prepare(
          `SELECT id FROM failure_records WHERE status IN ('open','ignored')
        AND INSTR(',' || COALESCE(download_task_ids, '') || ',', ',' || ? || ',') > 0`,
        )
        .all(task.id) as { id: string }[]
      for (const row of rows) failureIds.add(row.id)
    }
    const count = [...sourceSongs.values()].reduce((sum, songs) => sum + songs.size, 0) + sourceFailures.size + requeued.length
    if (!count) throw new Error('所选问题没有可重新处理的当前歌曲或失败文件任务，请刷新后重试')
    setFailureRecordStatus([...failureIds], 'open')
    incrementFailureRetries([...failureIds])
    return { count, sourceCount: sources.length, downloadTaskCount: requeued.length, sourceRequests }
  })()

  if (result.sourceCount)
    void getSyncWorker()
      ?.runOnce()
      .catch((error) => {
        appendLog({ level: 'error', message: '重试来源未能启动', detail: String(error) })
      })
  if (result.downloadTaskCount)
    void requestDownloadProcessing().catch((error) => {
      appendLog({ level: 'error', message: '重试下载未能启动', detail: String(error) })
    })
  return result
}

export function retryFailureRecords(ids: string[]) {
  return retryTargets(
    getFailureRecords(ids)
      .filter((record) => record.status !== 'resolved')
      .map((record) => ({
        sourceId: record.sourceId,
        songId: record.songId,
        downloadTaskIds: record.downloadTaskIds,
      })),
  )
}
