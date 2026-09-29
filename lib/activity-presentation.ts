import type { ActivityRun } from '../shared/activity'
import type { SyncStage } from '../server/lib/log/types'

const stages: Partial<Record<SyncStage, string>> = {
  fetching_playlist: '读取歌单', comparing: '分析差异', downloading: '下载歌曲',
  processing_tags: '写入标签', refreshing_plex: '等待 Plex 识别',
  updating_plex_playlist: '更新 Plex 歌单', reorder: '校准歌单顺序', repair: '补全资源',
}
export function liveStageLabel(stage: SyncStage): string { return stages[stage] || '等待进度更新' }
export function activityState(run: ActivityRun): 'waiting' | 'queued' | 'running' {
  if (run.status === 'awaiting_action') return 'waiting'
  if (run.sourceRequestStatus === 'pending') return 'queued'
  return 'running'
}
export function activityStage(run: ActivityRun): string {
  const state = activityState(run)
  if (state === 'waiting') return '分析已完成，等待你确认接管方案'
  if (state === 'queued') return '等待执行，轮到此任务后会自动开始'
  if (run.type === 'source_initialization') return '正在分析媒体关联，完成后需要你确认方案'
  if (run.live && stages[run.live.currentStage]) return stages[run.live.currentStage]!
  if (run.files?.counts.downloading) return '正在下载歌曲'
  if (run.files?.counts.tagging) return '正在写入标签'
  if (run.files?.counts.pending) return '等待文件处理'
  if (run.files?.counts.done) return '文件处理已完成，等待运行结果'
  return '任务正在执行，等待进度更新'
}
export function activityPlanLink(run: ActivityRun): string {
  return run.type === 'source_initialization' && run.sourceIds.length === 1
    ? `/sync-sources/${encodeURIComponent(run.sourceIds[0]!)}?tab=initialization`
    : `/task-center/runs/${run.id}`
}
export function activityPhases(run: ActivityRun) {
  if (!run.live || activityState(run) !== 'running') return []
  const stage = run.live.currentStage
  const current = ['fetching_playlist', 'comparing'].includes(stage) ? 0
    : ['downloading', 'processing_tags', 'repair'].includes(stage) ? 1
      : ['refreshing_plex', 'updating_plex_playlist', 'reorder'].includes(stage) ? 2 : -1
  if (current < 0) return []
  // Earlier phases may have been skipped; do not invent successful execution.
  return ['读取与分析', '文件处理', 'Plex 更新'].map((label, index) => ({ label, current: index === current }))
}
