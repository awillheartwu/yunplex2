import type { JobStatus, TaskRunTrigger, TaskRunType } from '~~/server/lib/job/types'
import { presentRunSummary } from '~~/lib/failure-cache-presentation'

export type RunTypeTone = 'sync' | 'download' | 'repair'

export interface RunTypeIdentity {
  label: string
  shortLabel: string
  icon: string
  tone: RunTypeTone
  description: string
}

export function runTypeIdentity(type: TaskRunType): RunTypeIdentity {
  if (type === 'manual_download') {
    return {
      label: '手动下载',
      shortLabel: '下载',
      icon: 'download',
      tone: 'download',
      description: '将选定歌曲下载并写入本地音乐库',
    }
  }
  if (type === 'repair') {
    return {
      label: '补全任务',
      shortLabel: '补全',
      icon: 'database',
      tone: 'repair',
      description: '修复缺失文件、标签或 Plex 关联',
    }
  }
  return {
    label: '同步任务',
    shortLabel: '同步',
    icon: 'sync',
    tone: 'sync',
    description: '对比同步源与 Plex，并应用歌曲变化',
  }
}

export function runTypeLabel(type: TaskRunType): string {
  return runTypeIdentity(type).label
}

export function runTypeIcon(type: TaskRunType): string {
  return runTypeIdentity(type).icon
}

export function runTypeTone(type: TaskRunType): RunTypeTone {
  return runTypeIdentity(type).tone
}

export function runTriggerLabel(trigger: TaskRunTrigger): string {
  if (trigger === 'schedule') return '定时触发'
  if (trigger === 'retry') return '失败重试'
  if (trigger === 'user') return '手动触发'
  return '系统触发'
}

export function runStatusLabel(status: JobStatus): string {
  if (status === 'running') return '运行中'
  if (status === 'success') return '成功'
  if (status === 'partial') return '部分成功'
  if (status === 'failed') return '失败'
  return '已取消'
}

export function runSummaryLabel(summary: string, fallback = ''): string {
  return presentRunSummary(summary || fallback)
}

export function runBadgeStatus(status: JobStatus): 'ok' | 'error' | 'warning' | 'running' | 'idle' {
  if (status === 'success') return 'ok'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'running'
  return 'idle'
}

export function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  return `${Math.floor(minutes / 60)}时${minutes % 60}分`
}
