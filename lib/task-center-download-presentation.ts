import type { TaskRunType } from '~~/server/lib/job/types'
import type { DownloadTask, QueueStatus } from '~~/server/lib/download/queue'
import type { SyncStage } from '~~/server/lib/log/types'

export type FlowState = 'complete' | 'current' | 'upcoming'

export interface FlowStageItem {
  key: string
  label: string
  state: FlowState
}

export interface QueueMetricItem {
  key: string
  label: string
  count: number
  tone: 'accent' | 'neutral' | 'success'
  description: string
}

const SYNC_FLOW_STAGES = [
  { key: 'download', label: '下载歌曲' },
  { key: 'tags', label: '写入标签' },
  { key: 'plex', label: '刷新 Plex' },
  { key: 'playlist', label: '更新歌单' },
] as const

const MANUAL_FLOW_STAGES = [
  { key: 'download', label: '下载歌曲' },
  { key: 'tags', label: '写入标签' },
  { key: 'done', label: '落盘完成' },
] as const

const ACTIVE_STATUS_WEIGHT: Record<DownloadTask['status'], number> = {
  downloading: 0,
  tagging: 1,
  done: 2,
  pending: 3,
  failed: 4,
}

export function isSyncLikeRun(runType: TaskRunType | null | undefined): boolean {
  return runType === 'sync' || runType === 'repair'
}

export function buildFlowStages(input: {
  runType: TaskRunType | null | undefined
  currentStage?: SyncStage | null
}): FlowStageItem[] {
  if (!input.runType) {
    return SYNC_FLOW_STAGES.map(stage => ({ ...stage, state: 'upcoming' as const }))
  }

  if (isSyncLikeRun(input.runType)) {
    const currentIndex = syncFlowStageIndex(input.currentStage)
    return SYNC_FLOW_STAGES.map((stage, index) => ({
      ...stage,
      state: resolveFlowState(index, currentIndex),
    }))
  }

  return MANUAL_FLOW_STAGES.map((stage, index) => ({
    ...stage,
    state: resolveFlowState(index, 0),
  }))
}

export function buildSongFlowStages(input: {
  task: DownloadTask
  runType: TaskRunType | null | undefined
  currentStage?: SyncStage | null
}): FlowStageItem[] {
  if (isSyncLikeRun(input.runType)) {
    const currentIndex = syncSongStageIndex(input.task, input.currentStage)
    return SYNC_FLOW_STAGES.map((stage, index) => ({
      ...stage,
      state: resolveFlowState(index, currentIndex),
    }))
  }

  const currentIndex = manualSongStageIndex(input.task)
  return MANUAL_FLOW_STAGES.map((stage, index) => ({
    ...stage,
    state: resolveFlowState(index, currentIndex),
  }))
}

export function buildQueueMetrics(
  status: QueueStatus,
  runType: TaskRunType | null | undefined,
): QueueMetricItem[] {
  const downstreamLabel = isSyncLikeRun(runType) ? '后续处理中' : '已完成'
  const downstreamDescription = isSyncLikeRun(runType)
    ? '下载和标签已完成，正在等待 Plex 识别或歌单更新。'
    : '本轮歌曲已经写入本地文件。'

  return [
    { key: 'downloading', label: '下载中', count: status.downloading, tone: 'accent', description: '正在写入音频文件。' },
    { key: 'tagging', label: '写标签', count: status.tagging, tone: 'accent', description: '正在写入歌词、封面和元数据。' },
    { key: 'done', label: downstreamLabel, count: status.done, tone: 'success', description: downstreamDescription },
    { key: 'pending', label: '等待下载', count: status.pending, tone: 'neutral', description: '还没占到下载槽位，按顺序等待。' },
  ]
}

export function taskStatusLabel(
  task: DownloadTask,
  runType: TaskRunType | null | undefined,
): string {
  if (task.status === 'pending') return '等待下载'
  if (task.status === 'downloading') return '下载中'
  if (task.status === 'tagging') return '写入标签'
  if (task.status === 'done') return isSyncLikeRun(runType) ? '后续处理中' : '已完成'
  return '失败'
}

export function taskProgressSummary(input: {
  task: DownloadTask
  runType: TaskRunType | null | undefined
  currentStage?: SyncStage | null
}): string {
  const { task, runType, currentStage } = input
  if (task.status === 'pending') return '等待进入下载槽位'
  if (task.status === 'downloading') return `音频下载 ${normalizeProgress(task.progress)}%`
  if (task.status === 'tagging') return `正在写入歌词、封面和标签 ${normalizeProgress(task.progress)}%`
  if (task.status === 'done') {
    if (!isSyncLikeRun(runType)) return '下载和标签写入已完成'
    if (currentStage === 'refreshing_plex') return '下载已完成，正在等待 Plex 识别新文件'
    if (currentStage === 'updating_plex_playlist' || currentStage === 'reorder') return 'Plex 已识别歌曲，正在更新歌单顺序和成员'
    return '下载前置已完成，等待进入 Plex 后续步骤'
  }
  return task.error || '任务失败'
}

export function sortLiveTasks(tasks: DownloadTask[]): DownloadTask[] {
  return [...tasks].sort((left, right) => {
    const statusDiff = ACTIVE_STATUS_WEIGHT[left.status] - ACTIVE_STATUS_WEIGHT[right.status]
    if (statusDiff !== 0) return statusDiff

    if (left.status === 'done' && right.status === 'done') {
      return right.updatedAt.localeCompare(left.updatedAt)
    }

    return left.createdAt.localeCompare(right.createdAt)
  })
}

export function normalizeProgress(value: number | null | undefined): number {
  return Math.min(100, Math.max(0, Math.round(value || 0)))
}

function resolveFlowState(index: number, currentIndex: number): FlowState {
  if (currentIndex < 0) return 'upcoming'
  if (index < currentIndex) return 'complete'
  if (index === currentIndex) return 'current'
  return 'upcoming'
}

function syncFlowStageIndex(stage?: SyncStage | null): number {
  if (stage === 'downloading') return 0
  if (stage === 'processing_tags' || stage === 'repair') return 1
  if (stage === 'refreshing_plex') return 2
  if (stage === 'updating_plex_playlist' || stage === 'reorder') return 3
  return -1
}

function syncSongStageIndex(task: DownloadTask, stage?: SyncStage | null): number {
  if (task.status === 'pending') return -1
  if (task.status === 'downloading') return 0
  if (task.status === 'tagging') return 1
  if (task.status !== 'done') return -1

  if (stage === 'refreshing_plex') return 2
  if (stage === 'updating_plex_playlist' || stage === 'reorder') return 3
  return 1
}

function manualSongStageIndex(task: DownloadTask): number {
  if (task.status === 'pending') return -1
  if (task.status === 'downloading') return 0
  if (task.status === 'tagging') return 1
  if (task.status === 'done') return 2
  return -1
}
