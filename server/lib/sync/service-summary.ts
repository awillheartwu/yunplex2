import type { SyncJob } from '../job/types'
import { recordActivityEvent } from '../activity/store'

export function buildSyncRunSummary(params: {
  job: SyncJob
  sourceCount: number
  dryRun: boolean
  rebuildMatch: boolean
  redownloadAll?: boolean
}): string {
  const { job, sourceCount, dryRun, rebuildMatch, redownloadAll } = params
  const summaryPrefix = redownloadAll ? '重新下载全部音频并同步' : rebuildMatch ? '重建缓存后全量同步' : dryRun ? '[预览]' : ''
  if (dryRun) return `${summaryPrefix} ${sourceCount} 个歌单源`.trim()
  if (redownloadAll) {
    const counts = [
      job.successSongs > 0 ? `重新下载 ${job.successSongs} 首` : '',
      job.skippedSongs > 0 ? `保护或保留 ${job.skippedSongs} 首` : '',
      job.failedSongs > 0 ? `失败 ${job.failedSongs} 首` : '',
      job.warnings > 0 ? `${job.warnings} 首需关注` : '',
    ].filter(Boolean)
    return `${summaryPrefix}：${sourceCount} 个源，${counts.length > 0 ? counts.join('，') : '没有可处理歌曲'}`
  }
  const counts = [
    job.successSongs > 0 ? `新增 ${job.successSongs} 首` : '',
    job.skippedSongs > 0 ? `已存在 ${job.skippedSongs} 首` : '',
    job.removedSongs > 0 ? `移除 ${job.removedSongs} 首` : '',
    job.failedSongs > 0 ? `失败 ${job.failedSongs} 首` : '',
    job.warnings > 0 ? `${job.warnings} 首需关注` : '',
  ].filter(Boolean)
  const detail = counts.length > 0 ? counts.join('，') : `无需变更（目标 ${job.totalSongs} 首）`
  return `${summaryPrefix ? `${summaryPrefix}：` : ''}${sourceCount} 个源，${detail}`
}

export function recordSyncRunCompletion(job: SyncJob, summary: string): void {
  recordActivityEvent({
    domain: 'sync',
    type: job.status === 'success' ? 'sync_run_completed' : job.status === 'partial' ? 'sync_run_partial' : 'sync_run_failed',
    severity: job.status === 'success' ? 'success' : job.status === 'partial' ? 'warning' : 'error',
    title: `本轮同步${job.status === 'success' ? '完成' : job.status === 'partial' ? '部分完成' : '失败'}`,
    summary,
    context: {
      jobId: job.id,
      successSongs: job.successSongs,
      existingSongs: job.skippedSongs,
      removedSongs: job.removedSongs,
      failedSongs: job.failedSongs,
      warningSongs: job.warnings,
      totalSongs: job.totalSongs,
    },
    link: `/task-center/runs/${job.id}`,
    groupKey: `job:${job.id}`,
  })
}
