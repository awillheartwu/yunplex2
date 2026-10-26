import { getDb, readConfigFromDb } from '../db'
import { getSource } from '../playlist/store'
import { assertSourcesReadyForConvergence } from '../source-initialization/gate'
import { requestSources } from '../sync/source-requests'
import { getSyncWorker } from '../sync/instance'
import { requeueFailedDownloadTasks } from '../download/queue'
import { requestDownloadProcessing } from '../download/worker'
import { appendLog } from '../log/store'
import { getFailureRecords, getRetryFailureIds } from './failure-queries'
import { reopenFailuresForRetry } from './failure-records'
import { failureSubjectKey, plexRemovalTarget } from './failure-identity'
import { resumePendingMediaRepairCommands } from '../download/media-repair-command'

import { resolveRecoveryTarget, type RetryTarget } from './recovery-targets'

/** Explicit retries reopen only the selected targets and start a fresh attempt budget. */
export function retryTargets(targets: readonly RetryTarget[]) {
  const result = getDb().transaction(() => {
    const sourceSongs = new Map<string, Set<number>>()
    const sourceFailures = new Set<string>()
    const removalSubjects = new Map<string, Set<string>>()
    const fileTaskIds = new Set<string>()
    const config = readConfigFromDb()
    for (const target of targets) {
      const eligibility = resolveRecoveryTarget(target, config, 'manual')
      if (!eligibility.eligible) {
        if (target.sourceId && !target.songId) throw new Error(eligibility.message)
        continue
      }
      if (eligibility.route === 'source') {
        const sourceId = eligibility.sourceId!
        const songs = sourceSongs.get(sourceId) ?? new Set<number>()
        if (target.songId) songs.add(target.songId)
        else if (target.plexPlaylistRatingKey && target.plexPlaylistItemId) {
          const subjects = removalSubjects.get(sourceId) ?? new Set<string>()
          subjects.add(failureSubjectKey({ ...target, songName: '' }))
          removalSubjects.set(sourceId, subjects)
        } else sourceFailures.add(sourceId)
        sourceSongs.set(sourceId, songs)
      } else for (const id of eligibility.taskIds) fileTaskIds.add(id)
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
    const failureIds = getRetryFailureIds(sourceSongs, removalSubjects, requeued.map(task => task.id))
    const count = [...sourceSongs.values()].reduce((sum, songs) => sum + songs.size, 0)
      + [...removalSubjects.values()].reduce((sum, subjects) => sum + subjects.size, 0) + sourceFailures.size + requeued.length
    if (!count) throw new Error('所选问题没有可重新处理的当前歌曲或失败文件任务，请刷新后重试')
    reopenFailuresForRetry(failureIds)
    return { count, sourceCount: sources.length, downloadTaskCount: requeued.length, sourceRequests }
  })()

  if (result.sourceCount)
    void getSyncWorker()
      ?.runOnce()
      .catch((error) => {
        appendLog({ level: 'error', message: '重试来源未能启动', detail: String(error) })
      })
  if (result.downloadTaskCount) {
    resumePendingMediaRepairCommands()
    void requestDownloadProcessing().catch((error) => {
      appendLog({ level: 'error', message: '重试下载未能启动', detail: String(error) })
    })
  }
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
        ...plexRemovalTarget(record.subjectKey),
      })),
  )
}
