import type { SyncJob } from '../job/types'
import { recordActivityEvent } from '../activity/store'

export function buildSyncRunSummary(params: {
  job: SyncJob
  sourceCount: number
  dryRun: boolean
  rebuildMatch: boolean
}): string {
  const { job, sourceCount, dryRun, rebuildMatch } = params
  const summaryPrefix = rebuildMatch ? '重建缓存后全量同步' : dryRun ? '[预览]' : ''
  if (dryRun) return `${summaryPrefix} ${sourceCount} 个歌单源`.trim()
  if (job.failedSongs > 0 || job.warnings > 0) {
    return `${summaryPrefix ? `${summaryPrefix}：` : ''}${sourceCount} 个源，成功 ${job.successSongs} 首${job.failedSongs > 0 ? `，失败 ${job.failedSongs} 首` : ''}${job.warnings > 0 ? `，${job.warnings} 首已忽略` : ''}`
  }
  return `${summaryPrefix ? `${summaryPrefix}：` : ''}${sourceCount} 个源，共同步 ${job.totalSongs} 首歌曲`
}

export function recordSyncRunCompletion(job: SyncJob, summary: string): void {
  recordActivityEvent({
    domain: 'sync',
    type: job.status === 'success' ? 'sync_run_completed' : job.status === 'partial' ? 'sync_run_partial' : 'sync_run_failed',
    severity: job.status === 'success' ? 'success' : job.status === 'partial' ? 'warning' : 'error',
    title: `本轮同步${job.status === 'success' ? '完成' : job.status === 'partial' ? '部分完成' : '失败'}`,
    summary,
    context: { jobId: job.id, successSongs: job.successSongs, failedSongs: job.failedSongs, totalSongs: job.totalSongs },
    link: `/task-center/runs/${job.id}`,
    groupKey: `job:${job.id}`,
  })
}
